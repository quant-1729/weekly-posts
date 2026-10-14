"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { findAction, nudgeFor, plainLine, resolveNode, tipFor } from "@/lib/tween/dialogue";
import { SIGNAL_EVENT, TIMING, planForEvent, recentSignal, talkMs, type TweenSignalDetail } from "@/lib/tween/events";
import { canSpeak, emptyBudget, newPageView, spend, type Budget, type UnpromptedKind } from "@/lib/tween/limits";
import { faceFor, initialMachine, poseEvent, reduce, viewState, type Dir, type PointDir, type TweenEvent } from "@/lib/tween/machine";
import { ROAM_MIN_WIDTH, canRoam, clampX, dockLayout, homeX, overlapArea, panelAlign, planPoint, planScroll, rect, walkDir, walkDuration, type Rect } from "@/lib/tween/motion";
import { KEYS, read, readJson, remove, write } from "@/lib/tween/storage";
import type { TweenAppEvent, TweenBundle } from "@/lib/tween/types";
import { Bubble } from "./Bubble";
import { Chips, type Chip } from "./Chips";
import { QuickControls, SettingsMenu } from "./Controls";
import { Spotlight } from "./Spotlight";
import { Transcript, type Entry } from "./Transcript";
import { TweenRig, squash } from "./TweenRig";
import { useMediaQuery } from "./useMediaQuery";
import "./tween.css";

/** Development builds accept ?tween=<state> (or ?tween=event:<app event>) to show a state for review. Removed from production builds. */
const DEV_HOOK = process.env.NODE_ENV !== "production";

const PANEL_W = 352;
/** The app header scrolls away (it is not sticky), so a target only needs a little air above it. */
const HEADER_OFFSET = 16;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 3000): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(50);
  }
}

async function scrollSettled(max = 1600) {
  let last = -1;
  let same = 0;
  const end = Date.now() + max;
  while (same < 3 && Date.now() < end) {
    await sleep(60);
    const y = window.scrollY;
    same = y === last ? same + 1 : 0;
    last = y;
  }
}

/** True while the owner is typing into a field: Tween does not speak up then. */
const typingNow = () => {
  const a = document.activeElement;
  return !!a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || (a as HTMLElement).isContentEditable);
};
const dialogOpen = () => !!document.querySelector("dialog[open]");

/** Rects in the bottom strip that Tween must not stand on, and the horizontal extent of the page text (to find the gutters). */
function gatherAvoid(el: Element, stripTop: number): { avoid: Rect[]; left: number; right: number } {
  const avoid: Rect[] = [];
  let left = Infinity;
  let right = -Infinity;
  const nodes = el.ownerDocument.querySelectorAll("main h1,main h2,main h3,main p,main li,main a,main button,main input,main select,main textarea,main dt,main dd,nav a");
  for (let i = 0; i < nodes.length && i < 300; i++) {
    const r = nodes[i]!.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (/^(H1|H2|H3|P)$/.test(nodes[i]!.tagName)) {
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    if (r.bottom > stripTop - 4 && r.top < window.innerHeight) avoid.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return { avoid, left: Number.isFinite(left) ? left : 0, right: Number.isFinite(right) ? right : window.innerWidth };
}

/** Right edge of the app shell's sidebar (0 when there is none: phones, the tablet top bar, the setup shell). Tween stays right of it. */
function readInset(): number {
  const el = document.querySelector<HTMLElement>("[data-app-sidebar]");
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? Math.round(r.right) : 0;
}

type Live = { pathname: string; still: boolean; roamOk: boolean; away: boolean; voice: boolean; x: number; vw: number; vh: number; inset: number; open: boolean; hidden: boolean };

export default function Tween({ bundle }: { bundle: TweenBundle }) {
  const M = bundle.tween;
  const ui = M.ui;
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [noRoam, setNoRoam] = useState(false);
  const [voice, setVoice] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);
  const [inset, setInset] = useState(0);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const finePointer = useMediaQuery("(pointer: fine)");
  const still = reduced || paused;
  const size = dockLayout(vw);
  const roamOk = canRoam({ width: vw, reducedMotion: reduced, paused, noRoam });

  const [m, dispatch] = useReducer(reduce, initialMachine);
  const [x, setX] = useState(0);
  const [dur, setDur] = useState(0);
  const [away, setAway] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [devPeek, setDevPeek] = useState(false);

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  // The whole node is laid out the moment a choice is made (lines hidden until said, replies hidden until ready) so
  // nothing moves while Tween types: a bubble growing line by line would be a layout shift.
  const [lines, setLines] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [choices, setChoices] = useState<Chip[]>([]);
  const [chipsReady, setChipsReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [skip, setSkip] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [spot, setSpot] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const [keepOpen, setKeepOpen] = useState(false);
  const [covering, setCovering] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const live = useRef<Live>({ pathname, still, roamOk, away, voice, x, vw, vh, inset, open, hidden });
  const runId = useRef(0);
  const typedResolver = useRef<(() => void) | null>(null);
  const homeTimer = useRef<number | null>(null);
  const budget = useRef<Budget>(emptyBudget);
  const blockedRef = useRef(false);
  const startedOnce = useRef(false);
  // First visit: Tween walks in from the edge and waves. `entering` keeps the dock follower from snapping it home first.
  const entering = useRef(false);
  const introPlan = useRef<{ walkIn: boolean } | null>(null);
  const introDone = useRef<Promise<void>>(Promise.resolve());
  // App events (events.ts): the latest reaction wins; its timers are cleared when the next one starts or the route changes.
  const signalRun = useRef(0);
  const eventTimers = useRef<Set<number>>(new Set());

  useEffect(() => {
    live.current = { pathname, still, roamOk, away, voice, x, vw, vh, inset, open, hidden };
    blockedRef.current = blocked;
  });

  /* ---------------------------------------------------------------- mount: saved preferences, session state */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of device and session state; it cannot run during SSR */
    const wasHidden = read("local", KEYS.hidden) === "1";
    const wasPaused = read("local", KEYS.paused) === "1";
    const wasNoRoam = read("local", KEYS.noRoam) === "1";
    setHidden(wasHidden);
    setPaused(wasPaused);
    setNoRoam(wasNoRoam);
    setVoice(read("local", KEYS.voice) === "1");
    setVoiceAvailable("speechSynthesis" in window);
    setEntries(readJson<Entry[]>("session", KEYS.transcript, []));
    const b = readJson<Partial<Budget>>("session", KEYS.budget, {});
    budget.current = { ...emptyBudget, sessionCount: b.sessionCount ?? 0, greeted: !!b.greeted, tipped: !!b.tipped, nudged: !!b.nudged, quiet: !!b.quiet };
    const w = window.innerWidth;
    setVw(w);
    setVh(window.innerHeight);
    // First visit on this device: walk in from the right edge (wide screens, motion allowed) and wave.
    if (!wasHidden && read("local", KEYS.intro) !== "1") {
      const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !wasPaused;
      const walkIn = motionOk && !wasNoRoam && w >= ROAM_MIN_WIDTH;
      introPlan.current = { walkIn };
      if (walkIn) {
        entering.current = true;
        setAway(true);
        setDur(0);
        setX(w + 8);
      }
    }
    setMounted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The sidebar's right edge: Tween's home and walks stay in the main area to its right.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the shell's layout is only known on the client
    setInset(readInset());
  }, [pathname, vw]);

  // Follow the home position unless Tween is out walking.
  useEffect(() => {
    if (entering.current) return;
    if (!away) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from viewport size, which only the client knows
      setX(homeX(vw, size.w, size.margin, inset));
      setDur(0);
    } else setX((p) => clampX(p, vw, size.w, size.margin, inset));
  }, [vw, size.w, size.margin, away, inset]);

  useEffect(() => {
    dispatch({ type: "CONTEXT", reduced: still, docked: !away });
  }, [still, away]);

  // Keep the walk cycle alive for a moment after walking stops so the legs ease back.
  useEffect(() => {
    if (m.state !== "walk") return;
    return () => {
      setCooling(true);
      window.setTimeout(() => setCooling(false), 420);
    };
  }, [m.state]);

  /* ---------------------------------------------------------------- persistence helpers */
  const persistBudget = useCallback(() => {
    const b = budget.current;
    write("session", KEYS.budget, JSON.stringify({ sessionCount: b.sessionCount, greeted: b.greeted, tipped: b.tipped, nudged: b.nudged, quiet: b.quiet }));
  }, []);
  const pushEntry = useCallback((e: Entry) => {
    setEntries((prev) => {
      const next = [...prev, e].slice(-60);
      write("session", KEYS.transcript, JSON.stringify(next));
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- movement */
  const walkTo = useCallback(async (to: number, dir: Dir, ms: number) => {
    dispatch({ type: "WALK", dir });
    setDur(ms);
    setX(to);
    await sleep(ms + 60);
    dispatch({ type: "ARRIVE" });
    if (!live.current.still) squash(rootRef.current?.querySelector<SVGElement>("svg.tw-rig"), "soft");
  }, []);

  const goHome = useCallback(async () => {
    if (homeTimer.current) window.clearTimeout(homeTimer.current);
    homeTimer.current = null;
    setSpot(null);
    dispatch({ type: "DONE" });
    const L = live.current;
    if (!L.away) return;
    const sz = dockLayout(L.vw);
    const target = homeX(L.vw, sz.w, sz.margin, L.inset);
    if (L.roamOk) await walkTo(target, walkDir(L.x, target), walkDuration(L.x, target));
    setAway(false);
  }, [walkTo]);

  const pointAt = useCallback(
    async (id: string, alive: () => boolean, patient: boolean): Promise<PointDir | null> => {
      // A page Tween just navigated to may still be rendering; the page we are already on either has the target or does not.
      const el = await waitFor(() => document.querySelector<HTMLElement>(`[data-tween-target="${CSS.escape(id)}"]`), patient ? 3000 : 400);
      if (!el || !alive()) return null;
      const L = live.current;
      const sz = dockLayout(L.vw);
      const strip = sz.h + sz.bottom + 16 + (L.open ? 120 : 0);
      let r = el.getBoundingClientRect();
      const delta = planScroll({ targetTop: r.top, targetBottom: r.bottom, viewportHeight: window.innerHeight, headerOffset: HEADER_OFFSET, stripHeight: strip });
      if (delta) {
        window.scrollBy({ top: delta, behavior: L.still ? "auto" : "smooth" });
        await scrollSettled(L.still ? 200 : 1600);
        if (!alive()) return null;
        r = el.getBoundingClientRect();
      }
      setSpot(id);
      if (!L.roamOk) return "up";
      const stripTop = window.innerHeight - sz.bottom - sz.h;
      const g = gatherAvoid(el, stripTop);
      const plan = planPoint({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        size: { width: sz.w, height: sz.h },
        bottomOffset: sz.bottom,
        margin: sz.margin,
        inset: L.inset,
        currentX: L.x,
        target: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        contentLeft: g.left,
        contentRight: g.right,
        avoid: g.avoid,
        panel: L.open ? { width: Math.min(PANEL_W, window.innerWidth - 24), height: panelRef.current?.offsetHeight ?? 260 } : null,
      });
      setAway(true);
      if (Math.abs(plan.x - L.x) > 2) await walkTo(plan.x, walkDir(L.x, plan.x), plan.duration);
      return alive() ? plan.pointDir : null;
    },
    [walkTo],
  );

  /* ---------------------------------------------------------------- speech */
  const speak = useCallback((text: string): Promise<void> => {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(plainLine(text));
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
        window.setTimeout(resolve, 20000);
      } catch {
        resolve();
      }
    });
  }, []);
  const stopSpeaking = () => {
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  };

  /* ---------------------------------------------------------------- dialogue */
  const cancelRun = useCallback(() => {
    runId.current++;
    typedResolver.current?.();
    typedResolver.current = null;
    stopSpeaking();
    setThinking(false);
    setTyping(false);
    dispatch({ type: "SAY_END" });
  }, []);

  const runNode = useCallback(
    async (id: string) => {
      cancelRun();
      const token = runId.current;
      const alive = () => runId.current === token;
      const L0 = live.current;
      const r = resolveNode(M, id, { tip: tipFor(M, L0.pathname) });
      if (!r) return;
      setLines(r.lines);
      setRevealed(0);
      setChoices(r.choices.map((c) => ({ label: c.label, value: c.next })));
      setChipsReady(false);
      setSkip(0);
      if (homeTimer.current) window.clearTimeout(homeTimer.current);
      if (!L0.still) {
        dispatch({ type: "THINK" });
        setThinking(true);
        await sleep(600);
        setThinking(false);
        if (!alive()) return;
      }
      let dir: PointDir | null = null;
      const go = findAction(r.actions, "goto");
      const navigates = !!go && go.goto !== live.current.pathname;
      if (go && navigates) {
        setKeepOpen(true);
        router.push(go.goto);
        await waitFor(() => live.current.pathname === go.goto, 4000);
        if (!alive()) return;
      }
      const target = findAction(r.actions, "point")?.point ?? findAction(r.actions, "scroll")?.scroll;
      dispatch({ type: "DONE" });
      if (target) {
        dir = await pointAt(target, alive, navigates);
        if (!alive()) return;
      }
      const pose = r.pose ?? "talk";
      const ev = dir ? ({ type: "POINT", dir } as TweenEvent) : poseEvent(pose === "point" ? "talk" : pose, "up");
      if (ev) dispatch(ev);
      for (const [i, line] of r.lines.entries()) {
        if (!alive()) return;
        setRevealed(i + 1);
        setTyping(true);
        pushEntry({ who: "tween", text: line });
        if (live.current.open) setAnnounce(plainLine(line));
        dispatch({ type: "SAY_START" });
        const spoken = live.current.voice ? speak(line) : Promise.resolve();
        await new Promise<void>((res) => {
          typedResolver.current = res;
        });
        await spoken;
        setTyping(false);
        if (!alive()) return;
        await sleep(live.current.still ? 0 : 220);
      }
      if (!alive()) return;
      dispatch({ type: "SAY_END" });
      setChipsReady(true);
      if (findAction(r.actions, "quiet")) {
        budget.current = { ...budget.current, quiet: true };
        persistBudget();
      }
      // The ring fades and Tween walks home a few seconds after the last line; a pose that is not pointing relaxes sooner.
      homeTimer.current = window.setTimeout(() => void goHome(), target ? 5000 : 1800);
    },
    [M, router, pointAt, goHome, pushEntry, speak, cancelRun, persistBudget],
  );

  /* ---------------------------------------------------------------- panel open / close */
  const openPanel = useCallback(
    () => {
      setGreeting(null);
      setOpen(true);
      dispatch({ type: "INPUT" });
      if (!startedOnce.current && lines.length === 0) {
        startedOnce.current = true;
        dispatch({ type: "WAVE" });
        void runNode(M.start);
      }
    },
    [M.start, runNode, lines.length],
  );
  const closePanel = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      setSettingsOpen(false);
      setSpot(null);
      cancelRun();
      if (homeTimer.current) window.clearTimeout(homeTimer.current);
      void goHome();
      startedOnce.current = lines.length > 0;
      if (refocus) toggleRef.current?.focus();
    },
    [cancelRun, goHome, lines.length],
  );

  // Route change: the panel closes unless Tween itself navigated; the transcript stays.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (!keepOpen) setOpen(false);
    setKeepOpen(false);
    setSpot(null);
    setGreeting(null);
  }

  const onChip = (c: Chip) => {
    pushEntry({ who: "you", text: c.label });
    void runNode(c.value);
  };

  const hide = useCallback(() => {
    write("local", KEYS.hidden, "1");
    cancelRun();
    setOpen(false);
    setSpot(null);
    setGreeting(null);
    setSettingsOpen(false);
    dispatch({ type: "HIDE" });
    setHidden(true);
    void goHome();
  }, [cancelRun, goHome]);
  const show = () => {
    write("local", KEYS.hidden, "0");
    setHidden(false);
    setDevPeek(false);
    budget.current = { ...budget.current, hidden: false };
    dispatch({ type: "SHOW" });
    window.setTimeout(() => {
      dispatch({ type: "WAVE" });
      squash(rootRef.current?.querySelector<SVGElement>("svg.tw-rig"), "hard");
    }, 50);
    window.setTimeout(() => dispatch({ type: "DONE" }), 1400);
  };
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    write("local", KEYS.paused, next ? "1" : "0");
  };
  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    write("local", KEYS.voice, next ? "1" : "0");
    if (!next) stopSpeaking();
  };
  const toggleRoam = () => {
    const next = !noRoam;
    setNoRoam(next);
    write("local", KEYS.noRoam, next ? "1" : "0");
    if (next) void goHome();
  };
  const restart = () => {
    setEntries([]);
    remove("session", KEYS.transcript);
    setSettingsOpen(false);
    setLines([]);
    setRevealed(0);
    startedOnce.current = true;
    void runNode(M.start);
  };

  /* ---------------------------------------------------------------- first visit: walk in and wave */
  useEffect(() => {
    const plan = introPlan.current;
    if (!mounted || !plan) return;
    introPlan.current = null;
    write("local", KEYS.intro, "1");
    // the wave is the greeting, so the greeting bubble does not also appear
    budget.current = { ...budget.current, greeted: true };
    persistBudget();
    introDone.current = (async () => {
      const L = live.current;
      if (plan.walkIn) {
        const sz = dockLayout(L.vw);
        await sleep(80);
        await walkTo(homeX(L.vw, sz.w, sz.margin, L.inset), "left", 1500);
        entering.current = false;
        setAway(false);
      } else if (!L.still) {
        squash(rootRef.current?.querySelector<SVGElement>("svg.tw-rig"), "hard");
      }
      dispatch({ type: "WAVE" });
      await sleep(L.still ? 1200 : TIMING.wave);
      dispatch({ type: "DONE" });
    })();
  }, [mounted, walkTo, persistBudget]);

  /* ---------------------------------------------------------------- app events (src/lib/tween/events.ts) */
  const clearEventTimers = useCallback(() => {
    eventTimers.current.forEach((t) => window.clearTimeout(t));
    eventTimers.current.clear();
  }, []);
  const handleSignal = useCallback(
    async (event: TweenAppEvent) => {
      const plan = planForEvent(M, event);
      if (!plan) return;
      if (plan.kind === "sleep") {
        // the idle timer: only a docked, quiet Tween falls asleep (the machine decides) and a reaction in progress is left alone
        dispatch({ type: "SLEEP" });
        return;
      }
      const run = ++signalRun.current;
      await introDone.current;
      if (signalRun.current !== run || live.current.hidden) return;
      clearEventTimers();
      const later = (fn: () => void, ms: number) => {
        const id = window.setTimeout(() => {
          eventTimers.current.delete(id);
          fn();
        }, ms);
        eventTimers.current.add(id);
      };
      setGreeting(null); // the previous reaction's bubble gives way to this one
      dispatch({ type: "INPUT" }); // wakes Tween if it was asleep
      dispatch({ type: "DONE" });
      const ev = poseEvent(plan.pose, "up");
      if (ev) dispatch(ev);
      // A held pose (thinking while posts are written) ends when the next event arrives, or after a safety limit.
      later(() => dispatch({ type: "DONE" }), plan.holdMs ?? TIMING.holdMax);
      const say = plan.say;
      if (say) {
        later(() => {
          // Reactions to the owner's own action may speak even when Tween is quiet about tips, but not into an open panel, and not if they chose "Just looking".
          if (live.current.hidden || live.current.open || budget.current.quiet) return;
          setGreeting(say);
          dispatch({ type: "SAY_START" });
          later(() => dispatch({ type: "SAY_END" }), talkMs(say));
        }, plan.sayAfterMs);
      }
    },
    [M, clearEventTimers],
  );

  useEffect(() => {
    if (!mounted) return;
    const onSignal = (e: Event) => {
      const d = (e as CustomEvent<TweenSignalDetail>).detail;
      if (d?.event) void handleSignal(d.event);
    };
    window.addEventListener(SIGNAL_EVENT, onSignal);
    // A signal sent while this chunk was still loading is replayed once if it is recent.
    const last = recentSignal(window.__tweenLast, Date.now());
    if (last) void handleSignal(last.event);
    return () => window.removeEventListener(SIGNAL_EVENT, onSignal);
  }, [mounted, handleSignal]);

  // Leaving the page ends any reaction in progress (thinking while posts are written belongs to the week page).
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    clearEventTimers();
    signalRun.current++;
    dispatch({ type: "DONE" });
  }, [pathname, clearEventTimers]);

  /* ---------------------------------------------------------------- developer hook: ?tween=state or ?tween=event:name */
  useEffect(() => {
    if (!DEV_HOOK || !mounted) return;
    const q = new URLSearchParams(window.location.search);
    const s = q.get("tween");
    if (!s) return;
    const dir = (q.get("dir") === "left" ? "left" : q.get("dir") === "up" ? "up" : "right") as PointDir;
    const ev: Record<string, TweenEvent | undefined> = {
      walk: { type: "WALK", dir: dir === "up" ? "right" : dir },
      wave: { type: "WAVE" },
      point: { type: "POINT", dir },
      talk: { type: "SAY_START" },
      think: { type: "THINK" },
      celebrate: { type: "CELEBRATE" },
      sleep: { type: "SLEEP" },
      shrug: { type: "SHRUG" },
    };
    /* eslint-disable react-hooks/set-state-in-effect -- test hook, runs once after mount */
    if (s.startsWith("event:")) {
      void handleSignal(s.slice(6) as TweenAppEvent);
    } else if (s === "cover") {
      setCovering(true);
    } else if (s === "peek") {
      setDevPeek(true);
      dispatch({ type: "HIDE" });
    } else if (ev[s]) {
      dispatch({ type: "CONTEXT", reduced: false, docked: true });
      dispatch(ev[s]!);
    }
    if (q.get("panel") === "1") openPanel();
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /* ---------------------------------------------------------------- active engine: only while Tween is visible */
  const active = mounted && !hidden && !devPeek;

  // Escape closes the panel and returns focus to Tween; a press outside closes it too.
  useEffect(() => {
    if (!open || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else closePanel(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("dialog")) return; // a dialog of the app is not an outside click
      if (rootRef.current && !rootRef.current.contains(t as Node)) closePanel(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, active, settingsOpen, closePanel]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      // never take focus from a reply the visitor is already on
      if (a && panelRef.current?.contains(a) && a.matches("[data-tween-chip], [data-tween='settings-toggle'], [data-tween='settings'] button")) return;
      const first = (sel: string) => panelRef.current?.querySelector<HTMLElement>(sel) ?? null;
      const el = first("[data-tween-chip]") ?? first("[data-tween='close']");
      el?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, chipsReady]);

  // Hide while a dialog of the app is open.
  useEffect(() => {
    if (!active) return;
    const compute = () => setBlocked(dialogOpen());
    const mo = new MutationObserver(compute);
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["open"] });
    compute();
    return () => mo.disconnect();
  }, [active, pathname]);

  // WCAG 2.4.11: a focused control is never left under Tween. If it would be, Tween steps to the other side of the screen
  // for as long as that element has focus, then goes home.
  useEffect(() => {
    if (!active) return;
    let back = 0;
    const footprint = (at: number) => {
      const L = live.current;
      const sz = dockLayout(L.vw);
      const r = rect(at, L.vh - sz.bottom - sz.h, sz.w, sz.h);
      const panel = panelRef.current;
      return panel ? [r, panel.getBoundingClientRect()] : [r];
    };
    const covered = (el: Element, at: number) => {
      const b = el.getBoundingClientRect();
      return footprint(at).some((f) => overlapArea({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }, { left: f.left, top: f.top, right: f.right, bottom: f.bottom }) > 0);
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.getBoundingClientRect || rootRef.current?.contains(t) || t === document.body) return;
      const L = live.current;
      const sz = dockLayout(L.vw);
      const home = homeX(L.vw, sz.w, sz.margin, L.inset);
      const other = clampX(sz.margin, L.vw, sz.w, sz.margin, L.inset);
      window.clearTimeout(back);
      if (covered(t, L.x)) {
        const to = Math.abs(L.x - home) < 4 ? other : home;
        setAway(true);
        setDur(L.still ? 0 : 220);
        setX(to);
        back = window.setTimeout(() => {
          const a = document.activeElement;
          if (a && a !== document.body && covered(a, home)) return;
          void goHome();
        }, 2500);
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.clearTimeout(back);
    };
  }, [active, goHome]);

  // Unprompted behaviour: one greeting, one route tip, one idle nudge, all under the limits in lib/tween/limits.ts.
  const unprompted = useCallback((kind: UnpromptedKind, text: string | null) => {
    if (!text) return;
    const L = live.current;
    const ok = canSpeak(budget.current, kind, { dialogOpen: dialogOpen(), typing: typingNow(), panelOpen: L.open });
    if (!ok) return;
    budget.current = spend(budget.current, kind);
    persistBudget();
    setGreeting(text);
    dispatch({ type: "WAVE" });
    window.setTimeout(() => dispatch({ type: "DONE" }), 1600);
  }, [persistBudget]);
  const firstPage = useRef(true);
  useEffect(() => {
    if (!active) return;
    budget.current = newPageView(budget.current);
    const timers: number[] = [];
    const nudge = nudgeFor(M, pathname);
    if (firstPage.current) {
      firstPage.current = false;
      if (!nudge) timers.push(window.setTimeout(() => unprompted("greeting", M.greeting), 4500));
    } else {
      timers.push(window.setTimeout(() => unprompted("tip", tipFor(M, pathname)), 1800));
    }
    // Idle timers (nudge after 45 s, sleep after 60 s) restart on real input.
    let nudgeT = 0;
    let sleepT = 0;
    const arm = () => {
      window.clearTimeout(nudgeT);
      window.clearTimeout(sleepT);
      if (nudge) nudgeT = window.setTimeout(() => unprompted("nudge", nudge), 45000);
      sleepT = window.setTimeout(() => void handleSignal("idle"), 60000);
    };
    const onInput = () => {
      dispatch({ type: "INPUT" });
      arm();
    };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    arm();
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(nudgeT);
      window.clearTimeout(sleepT);
      evs.forEach((e) => window.removeEventListener(e, onInput));
    };
  }, [active, pathname, M, unprompted, handleSignal]);

  // Greeting bubble leaves by itself after a while (not while it has focus).
  useEffect(() => {
    if (!greeting) return;
    const t = window.setTimeout(() => setGreeting(null), TIMING.bubble);
    return () => window.clearTimeout(t);
  }, [greeting]);

  // Idle life: blink every three to six seconds, an occasional look-around. Nothing runs while still, hidden or paused.
  useEffect(() => {
    if (!active || still) return;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const svg = () => rootRef.current?.querySelector<SVGElement>("svg.tw-rig");
    const blink = () => {
      later(() => {
        if (!document.hidden) {
          svg()?.setAttribute("data-blink", "true");
          later(() => svg()?.removeAttribute("data-blink"), 130);
        }
        blink();
      }, 3000 + Math.random() * 3000);
    };
    const look = () => {
      later(() => {
        if (!document.hidden) {
          const s = svg();
          s?.style.setProperty("--lx", String(Math.random() < 0.5 ? -6 : 6));
          s?.style.setProperty("--ly", "-1");
          later(() => {
            s?.style.removeProperty("--lx");
            s?.style.removeProperty("--ly");
          }, 1100);
        }
        look();
      }, 8000 + Math.random() * 6000);
    };
    blink();
    look();
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, [active, still]);

  // Eyes follow the pointer on devices that have one, one animation frame at a time.
  useEffect(() => {
    if (!active || still || !finePointer) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const svg = rootRef.current?.querySelector<SVGElement>("svg.tw-rig");
        const anchor = rootRef.current?.firstElementChild?.getBoundingClientRect();
        if (!svg || !anchor) return;
        const dx = e.clientX - (anchor.left + anchor.width / 2);
        const dy = e.clientY - (anchor.top + anchor.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 260);
        svg.style.setProperty("--px", String(((dx / d) * 8 * k).toFixed(2)));
        svg.style.setProperty("--py", String(((dy / d) * 6 * k).toFixed(2)));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, still, finePointer]);

  // Shy about email addresses: Tween covers its eyes while an email field has focus.
  useEffect(() => {
    if (!active) return;
    const isEmail = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type === "email";
    const onIn = (e: FocusEvent) => setCovering(isEmail(e.target));
    const onOut = (e: FocusEvent) => {
      if (isEmail(e.target) && !isEmail(e.relatedTarget)) setCovering(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
      setCovering(false);
    };
  }, [active]);

  // Scroll step: while the page scrolls, Tween walks in place in step with the scroll position (220 px per stride),
  // facing the way the page moves. Only when standing docked and idle; one animation frame at a time.
  useEffect(() => {
    if (!active || still) return;
    let raf = 0;
    let stop = 0;
    let lastY = window.scrollY;
    const svg = () => rootRef.current?.querySelector<SVGElement>("svg.tw-rig");
    const end = () => {
      const s = svg();
      s?.removeAttribute("data-scrub");
      s?.removeAttribute("data-scrub-dir");
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = svg();
        const y = window.scrollY;
        const st = s?.getAttribute("data-state");
        if (!s || live.current.away || (st !== "idle" && st !== "talk")) {
          end();
          lastY = y;
          return;
        }
        if (y !== lastY) s.setAttribute("data-scrub-dir", y > lastY ? "down" : "up");
        lastY = y;
        s.style.setProperty("--scrub", (((y / 220) % 1) * 0.64).toFixed(3));
        s.setAttribute("data-scrub", "true");
        window.clearTimeout(stop);
        stop = window.setTimeout(end, 180);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(stop);
      if (raf) cancelAnimationFrame(raf);
      end();
    };
  }, [active, still]);

  // Leave nothing running when Tween unmounts.
  useEffect(
    () => () => {
      runId.current++;
      signalRun.current++;
      eventTimers.current.forEach((t) => window.clearTimeout(t));
      eventTimers.current.clear();
      if (homeTimer.current) window.clearTimeout(homeTimer.current);
      stopSpeaking();
    },
    [],
  );

  /* ---------------------------------------------------------------- render */
  if (!mounted || !M) return null;

  const base = viewState(m);
  const view = covering && (base === "idle" || base === "talk" || base === "sleep") ? "cover" : base;
  const face = faceFor(view);
  const peeking = hidden || devPeek;

  if (peeking) {
    return (
      <button type="button" data-tween="show" className="tw-peek" style={{ bottom: size.bottom }} onClick={show}>
        <span className="sr-only">{ui.show}</span>
        <TweenRig state="peek" face="neutral" facing="left" pointDir="left" talking={false} still={still} mirror />
      </button>
    );
  }

  const panelW = Math.min(PANEL_W, vw - 24);
  const align = panelAlign(x, panelW, vw);
  // The panel and its tail are placed with transforms only (the layout position never changes), so walking never shifts layout.
  const panelLeft = Math.min(Math.max(x + size.w - panelW, inset + 12), Math.max(inset + 12, vw - panelW - 12));
  const tailX = Math.min(Math.max(x + size.w / 2 - panelLeft - 6, 14), panelW - 26);
  const moveTransition = dur && !still ? `transform ${dur}ms cubic-bezier(0.45, 0, 0.55, 1)` : "none";
  const controlsCopy = { ...ui };
  const controlState = { paused, voice, voiceAvailable, noRoam };
  const typingIndex = revealed - 1;

  return (
    <>
      <Spotlight target={spot} />
      <div
        ref={rootRef}
        data-tween="root"
        data-state={view}
        data-open={open ? "true" : "false"}
        data-away={away ? "true" : "false"}
        data-blocked={blocked ? "true" : "false"}
        data-align={align}
        className="tw-root"
        style={{ bottom: size.bottom, transform: `translateX(${x}px)`, transition: moveTransition, ["--aw" as string]: `${size.w}px` }}
      >
        <div className="tw-anchor" style={{ width: size.w, height: size.h }}>
          <button
            ref={toggleRef}
            type="button"
            data-tween="toggle"
            className="tw-toggle"
            aria-expanded={open}
            aria-controls="tween-panel"
            aria-label={open ? ui.closeLabel : ui.openLabel}
            onClick={() => (open ? closePanel(false) : openPanel())}
          >
            <TweenRig state={view} face={face} facing={m.facing} pointDir={m.pointDir} talking={m.talking} still={still} cooling={cooling} />
          </button>
          <QuickControls copy={controlsCopy} state={controlState} onPause={togglePause} onHide={hide} />
          {greeting && !open && (
            <div data-tween="greeting" className="tw-greet">
              <p>{greeting}</p>
              <button type="button" className="tw-icon-btn" data-tween="greeting-dismiss" onClick={() => setGreeting(null)}>
                <span className="sr-only">{ui.dismiss}</span>
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
                  <path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}
          {open && (
            <section
              id="tween-panel"
              ref={panelRef}
              aria-label={ui.panelLabel}
              data-tween="panel"
              className="tw-panel"
              style={{ transform: `translate(${panelLeft - x}px, -100%)`, transition: moveTransition, ["--tail-x" as string]: `${tailX}px` }}
            >
              <div className="tw-scroll">
                <div className="tw-head">
                  <p className="tw-title">{M.name}</p>
                  <button type="button" className="tw-link tw-skip" data-tween="skip" style={{ visibility: typing && !still ? "visible" : "hidden" }} onClick={() => setSkip((n) => n + 1)}>
                    {ui.skip}
                  </button>
                  <div className="tw-head-btns">
                    <button type="button" className="tw-icon-btn" data-tween="settings-toggle" aria-expanded={settingsOpen} aria-controls="tween-settings" onClick={() => setSettingsOpen((v) => !v)}>
                      <span className="sr-only">{ui.settings}</span>
                      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                        <circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M10 2 V5 M10 15 V18 M2 10 H5 M15 10 H18 M4.5 4.5 L6.6 6.6 M13.4 13.4 L15.5 15.5 M4.5 15.5 L6.6 13.4 M13.4 6.6 L15.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button type="button" className="tw-icon-btn" data-tween="close" onClick={() => closePanel(true)}>
                      <span className="sr-only">{ui.closeButton}</span>
                      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                        <path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
                {settingsOpen && (
                  <div id="tween-settings">
                    <SettingsMenu copy={controlsCopy} state={controlState} onPause={togglePause} onVoice={toggleVoice} onRoam={toggleRoam} onRestart={restart} onHide={hide} />
                  </div>
                )}
                {/* the finished line is announced once, and only while the panel is open */}
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-tween="live">
                  {announce}
                </div>
                <div className="tw-bubbles" data-tween="bubbles">
                  {lines.map((line, i) => (
                    <Bubble key={`${i}-${line}`} text={line} started={i < revealed} instant={still || i < typingIndex} skip={skip} onDone={i === typingIndex ? () => typedResolver.current?.() : undefined} />
                  ))}
                  {thinking && (
                    <span className="tw-think" role="img" aria-label={ui.thinking}>
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
                <Chips chips={choices} ready={chipsReady} label={ui.choicesLabel} onPick={onChip} />
                <Transcript
                  entries={entries}
                  open={transcriptOpen}
                  onToggle={() => setTranscriptOpen((v) => !v)}
                  copy={{ show: ui.transcriptShow, hide: ui.transcriptHide, label: ui.transcriptLabel, tween: ui.speakerTween, you: ui.speakerYou }}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
