"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMediaQuery } from "@/lib/use-media-query";
import { findAction, plainLine, resolveNode, tipFor, nudgeFor } from "@/lib/mascot/dialogue";
import { canSpeak, emptyBudget, isFormPath, newPageView, spend, type Budget, type UnpromptedKind } from "@/lib/mascot/limits";
import { faceFor, initialMachine, poseEvent, reduce, viewState, type Dir, type PointDir, type TweenEvent } from "@/lib/mascot/machine";
import { canRoam, clampX, homeX, overlapArea, panelAlign, planPoint, planScroll, rect, walkDir, walkDuration, type Rect } from "@/lib/mascot/motion";
import type { TweenBundle } from "@/lib/mascot/types";
import { KEYS, read, readJson, remove, write } from "@/lib/mascot/storage";
import { track } from "@/lib/tracking";
import { Bubble } from "./Bubble";
import { Chips, type Chip } from "./Chips";
import { PlacedLetter, TweenIntro, type LetterSpot } from "./Intro";
import { QuickControls, SettingsMenu } from "./Controls";
import { LeadFlow, useLeadFlow } from "./LeadFlow";
import { Spotlight } from "./Spotlight";
import { Transcript, type Entry } from "./Transcript";
import { SectionPeek, peekable, type PeekSpot } from "./Peek";
import { TweenRig, squash } from "./TweenRig";
import "./tween.css";

/** Development and preview builds accept ?tween=<state> to show a state for review. The branch is removed from production builds. */
const DEV_HOOK = process.env.NEXT_PUBLIC_SITE_MODE !== "production";

const SIZE = {
  desktop: { w: 84, h: 102, margin: 20, bottom: 24 },
  mobile: { w: 79, h: 96, margin: 12, bottom: 96 },
};
const PANEL_W = 352;
const HEADER_OFFSET = 96;
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

type Live = { pathname: string; still: boolean; roamOk: boolean; away: boolean; voice: boolean; x: number; vw: number; vh: number; open: boolean };

export default function Tween({ bundle }: { bundle: TweenBundle }) {
  const { mascot: M, form, email, sla, facts } = bundle;
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
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const finePointer = useMediaQuery("(pointer: fine)");
  const still = reduced || paused;
  const mobile = vw < 768;
  const size = mobile ? SIZE.mobile : SIZE.desktop;
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
  const [introOn, setIntroOn] = useState(false);
  const [letterSpot, setLetterSpot] = useState<LetterSpot | null>(null);
  const [covering, setCovering] = useState(false);
  const [peekSpot, setPeekSpot] = useState<PeekSpot | null>(null);
  const endPeek = useCallback(() => setPeekSpot(null), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const live = useRef<Live>({ pathname, still, roamOk, away, voice, x, vw, vh, open });
  const runId = useRef(0);
  const typedResolver = useRef<(() => void) | null>(null);
  const homeTimer = useRef<number | null>(null);
  const budget = useRef<Budget>(emptyBudget);
  const blockedRef = useRef(false);
  const startedOnce = useRef(false);

  useEffect(() => {
    live.current = { pathname, still, roamOk, away, voice, x, vw, vh, open };
    blockedRef.current = blocked;
  });

  /* ---------------------------------------------------------------- mount: saved preferences, session state */
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of device and session state; it cannot run during SSR */
    setHidden(read("local", KEYS.hidden) === "1");
    setPaused(read("local", KEYS.paused) === "1");
    setNoRoam(read("local", KEYS.noRoam) === "1");
    setVoice(read("local", KEYS.voice) === "1");
    setVoiceAvailable("speechSynthesis" in window);
    setEntries(readJson<Entry[]>("session", KEYS.transcript, []));
    const b = readJson<Partial<Budget>>("session", KEYS.budget, {});
    budget.current = { ...emptyBudget, sessionCount: b.sessionCount ?? 0, greeted: !!b.greeted, tipped: !!b.tipped, nudged: !!b.nudged, quiet: !!b.quiet };
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    setMounted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Follow the home position unless Tween is out walking.
  useEffect(() => {
    if (!away) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from viewport size, which only the client knows
      setX(homeX(vw, size.w, size.margin));
      setDur(0);
    } else setX((p) => clampX(p, vw, size.w, size.margin));
  }, [vw, size.w, size.margin, away]);

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
  const persistBudget = () => {
    const b = budget.current;
    write("session", KEYS.budget, JSON.stringify({ sessionCount: b.sessionCount, greeted: b.greeted, tipped: b.tipped, nudged: b.nudged, quiet: b.quiet }));
  };
  const pushEntry = useCallback((e: Entry) => {
    setEntries((prev) => {
      const next = [...prev, e].slice(-60);
      write("session", KEYS.transcript, JSON.stringify(next));
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- movement */
  const gatherAvoid = (el: Element, stripTop: number): { avoid: Rect[]; left: number; right: number } => {
    const avoid: Rect[] = [];
    let left = Infinity;
    let right = -Infinity;
    const nodes = el.querySelectorAll("h1,h2,h3,p,li,a,button,input,select,textarea,dt,dd,[data-lead-form],[data-cta-id]");
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
  };

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
    const size0 = L.vw < 768 ? SIZE.mobile : SIZE.desktop;
    const target = homeX(L.vw, size0.w, size0.margin);
    if (L.roamOk) await walkTo(target, walkDir(L.x, target), walkDuration(L.x, target));
    setAway(false);
  }, [walkTo]);

  const pointAt = useCallback(
    async (id: string, alive: () => boolean): Promise<PointDir | null> => {
      const el = await waitFor(() => document.querySelector<HTMLElement>(`[data-tween-target="${CSS.escape(id)}"]`), 3500);
      if (!el || !alive()) return null;
      const L = live.current;
      const sz = L.vw < 768 ? SIZE.mobile : SIZE.desktop;
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
  const flowRef = useRef<ReturnType<typeof useLeadFlow> | null>(null);
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
      const r = resolveNode(M, id, { facts, tip: tipFor(M, L0.pathname) });
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
      if (go && go.goto !== live.current.pathname) {
        setKeepOpen(true);
        router.push(go.goto);
        await waitFor(() => live.current.pathname === go.goto, 4000);
        if (!alive()) return;
      }
      const target = findAction(r.actions, "point")?.point ?? findAction(r.actions, "scroll")?.scroll;
      dispatch({ type: "DONE" });
      if (target) {
        dir = await pointAt(target, alive);
        if (!alive()) return;
      }
      const pose = r.pose ?? "talk";
      const ev = target ? ({ type: "POINT", dir: dir ?? "up" } as TweenEvent) : poseEvent(pose, "up");
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
      if (findAction(r.actions, "lightbox")) {
        const btn = await waitFor(() => document.querySelector<HTMLElement>("[data-work-card] [data-play]"), 2500);
        if (btn && alive()) btn.click();
      }
      setChipsReady(true);
      if (findAction(r.actions, "leadFlow")) flowRef.current?.start();
      if (findAction(r.actions, "quiet")) {
        budget.current = { ...budget.current, quiet: true };
        persistBudget();
      }
      // The ring fades and Tween walks home a few seconds after the last line; a pose that is not pointing relaxes sooner.
      homeTimer.current = window.setTimeout(() => void goHome(), target ? 5000 : 1800);
    },
    [M, facts, router, pointAt, goHome, pushEntry, speak, cancelRun],
  );

  const flow = useLeadFlow({
    pathname,
    copy: M.lead,
    form,
    onEntry: pushEntry,
    onSuccess: () => {
      dispatch({ type: "CELEBRATE" });
      window.setTimeout(() => dispatch({ type: "DONE" }), 2200);
    },
    onOpenForm: () => {
      pushEntry({ who: "tween", text: M.lead.formOpened });
      setKeepOpen(false);
      setOpen(false);
      router.push("/contact");
    },
  });
  useEffect(() => {
    flowRef.current = flow;
  });

  /* ---------------------------------------------------------------- panel open / close */
  const openPanel = useCallback(
    (by: "user" | "dev" = "user") => {
      setGreeting(null);
      setOpen(true);
      if (by === "user") track("tween_open", { path: live.current.pathname });
      dispatch({ type: "INPUT" });
      if (!startedOnce.current && lines.length === 0 && !flow.s.active) {
        startedOnce.current = true;
        dispatch({ type: "WAVE" });
        void runNode(M.start);
      }
    },
    [M.start, runNode, lines.length, flow.s.active],
  );
  const closePanel = useCallback(
    (refocus: boolean) => {
      setOpen(false);
      setSettingsOpen(false);
      setSpot(null);
      cancelRun();
      if (homeTimer.current) window.clearTimeout(homeTimer.current);
      void goHome();
      startedOnce.current = lines.length > 0 || flow.s.active;
      if (refocus) toggleRef.current?.focus();
    },
    [cancelRun, goHome, lines.length, flow.s.active],
  );

  // Route change: the panel closes unless Tween itself navigated; the transcript stays.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (!keepOpen) setOpen(false);
    setKeepOpen(false);
    setSpot(null);
    setGreeting(null);
    setIntroOn(false);
    setLetterSpot(null);
  }

  const onChip = (c: Chip) => {
    track("tween_choice", { node: c.value });
    pushEntry({ who: "you", text: c.label });
    void runNode(c.value);
  };

  const hide = useCallback(() => {
    write("local", KEYS.hidden, "1");
    track("tween_hide");
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
    flow.cancel();
    setEntries([]);
    remove("session", KEYS.transcript);
    setSettingsOpen(false);
    setLines([]);
    setRevealed(0);
    startedOnce.current = true;
    void runNode(M.start);
  };

  /* ---------------------------------------------------------------- first-visit intro (Home, once per session) */
  useEffect(() => {
    if (!mounted) return;
    const q = new URLSearchParams(window.location.search).get("tween");
    const force = DEV_HOOK && q === "intro";
    if (q && !force) return;
    if (!M.intro || hidden || still || pathname !== "/" || isFormPath(pathname)) return;
    if (!force && read("session", KEYS.intro) === "1") return;
    write("session", KEYS.intro, "1");
    // the letter carries the greeting, so the greeting bubble does not also appear
    budget.current = { ...budget.current, greeted: true };
    persistBudget();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decided once after mount from session state
    setIntroOn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /* ---------------------------------------------------------------- developer hook: ?tween=state */
  useEffect(() => {
    if (!DEV_HOOK || !mounted) return;
    const q = new URLSearchParams(window.location.search);
    const s = q.get("tween");
    if (!s || s === "intro") return;
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
    if (s === "cover") {
      setCovering(true);
    } else if (s === "peek") {
      setDevPeek(true);
      dispatch({ type: "HIDE" });
    } else if (ev[s]) {
      dispatch({ type: "CONTEXT", reduced: false, docked: true });
      dispatch(ev[s]!);
    }
    if (q.get("panel") === "1") openPanel("dev");
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /* ---------------------------------------------------------------- active engine: only while Tween is visible */
  const active = mounted && !hidden && !devPeek && !isFormPath(pathname);

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
      if (t?.closest?.("dialog")) return; // the lightbox Tween opened is not an outside click
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
      // never take focus from a reply or field the visitor is already on
      if (a && panelRef.current?.contains(a) && a.matches("[data-tween-chip], input, [data-tween='settings-toggle'], [data-tween='settings'] button")) return;
      const first = (sel: string) => panelRef.current?.querySelector<HTMLElement>(sel) ?? null;
      const el = first("[data-tween-chip]") ?? first("[data-tween='lead-input']") ?? first("[data-tween='lead-consent']") ?? first("[data-tween='close']");
      el?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, chipsReady, flow.s.active]);

  // Hide while the lightbox, the mobile menu or a form is in view.
  useEffect(() => {
    if (!active) return;
    let formInView = false;
    const compute = () => {
      const lightbox = !!document.querySelector("dialog[data-lightbox][open]");
      const menu = document.getElementById("main")?.hasAttribute("inert") ?? false;
      setBlocked(lightbox || menu || formInView);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) formInView = e.isIntersecting;
      compute();
    }, { threshold: 0.05 });
    document.querySelectorAll("[data-lead-form]").forEach((f) => io.observe(f));
    const mo = new MutationObserver(compute);
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["open", "inert"] });
    compute();
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [active, pathname]);

  // WCAG 2.4.11: a focused control is never left under Tween. If it would be, Tween steps to the other side of the screen
  // for as long as that element has focus, then goes home.
  useEffect(() => {
    if (!active) return;
    let back = 0;
    const footprint = (at: number) => {
      const L = live.current;
      const sz = L.vw < 768 ? SIZE.mobile : SIZE.desktop;
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
      const sz = L.vw < 768 ? SIZE.mobile : SIZE.desktop;
      const home = homeX(L.vw, sz.w, sz.margin);
      const other = clampX(sz.margin, L.vw, sz.w, sz.margin);
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

  // Unprompted behaviour: one greeting, one route tip, one idle nudge, all under the limits in lib/mascot/limits.ts.
  const unprompted = useCallback(
    (kind: UnpromptedKind, text: string | null) => {
      if (!text) return;
      const L = live.current;
      const ok = canSpeak(budget.current, kind, L.pathname, {
        menuOpen: document.getElementById("main")?.hasAttribute("inert") ?? false,
        lightboxOpen: !!document.querySelector("dialog[data-lightbox][open]"),
        formActive: blockedRef.current,
        panelOpen: L.open,
      });
      if (!ok) return;
      budget.current = spend(budget.current, kind);
      persistBudget();
      setGreeting(text);
      dispatch({ type: "WAVE" });
      window.setTimeout(() => dispatch({ type: "DONE" }), 1600);
    },
    [],
  );
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
      sleepT = window.setTimeout(() => dispatch({ type: "SLEEP" }), 60000);
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
  }, [active, pathname, M, unprompted]);

  // Greeting bubble leaves by itself after a while (not while it has focus).
  useEffect(() => {
    if (!greeting) return;
    const t = window.setTimeout(() => setGreeting(null), 9000);
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

  // Shy about email addresses: Tween covers its eyes while an email field has focus (its own chat step included).
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
    if (!active || still || introOn) return;
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
  }, [active, still, introOn]);

  // Section peek: as a new section scrolls up into view, a small Tween pops over its top edge and waves. At most two
  // per page view, at least ten seconds apart, never while the panel is open, Tween is out walking or a form is in view.
  useEffect(() => {
    if (!active || still || introOn) return;
    let shown = 0;
    let last = 0;
    let side: "l" | "r" = "r";
    const seen = new WeakSet<Element>();
    const sections = Array.from(document.querySelectorAll<HTMLElement>("#main section")).slice(1);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (!e.isIntersecting || seen.has(el)) continue;
          const L = live.current;
          if (shown >= 2 || Date.now() - last < 10000 || L.open || L.away || blockedRef.current || document.hidden) continue;
          if (!peekable(el)) continue;
          seen.add(el);
          shown++;
          last = Date.now();
          setPeekSpot({ section: el, side, key: last });
          side = side === "r" ? "l" : "r";
        }
      },
      { threshold: [0, 0.2], rootMargin: "0px 0px -25% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => {
      io.disconnect();
      setPeekSpot(null);
    };
  }, [active, still, introOn, pathname]);

  // Leave nothing running when Tween unmounts.
  useEffect(
    () => () => {
      runId.current++;
      if (homeTimer.current) window.clearTimeout(homeTimer.current);
      stopSpeaking();
    },
    [],
  );

  /* ---------------------------------------------------------------- render */
  if (!mounted || !M || isFormPath(pathname)) return null;

  const base = viewState(m);
  const view = covering && (base === "idle" || base === "talk" || base === "sleep") ? "cover" : base;
  const face = faceFor(view);
  const peeking = hidden || devPeek;

  const letterEl = letterSpot && M.intro ? <PlacedLetter spot={letterSpot} copy={M.intro} /> : null;

  if (introOn && !peeking) {
    return (
      <>
        <TweenIntro
          size={size}
          onLetter={setLetterSpot}
          onDone={(talk) => {
            setIntroOn(false);
            if (talk) window.setTimeout(() => openPanel(), 60);
          }}
        />
        {letterEl}
      </>
    );
  }

  if (peeking) {
    return (
      <button type="button" data-tween="show" className="tw-peek" style={{ bottom: mobile ? 96 : 24 }} onClick={show}>
        <span className="sr-only">{ui.show}</span>
        <TweenRig state="peek" face="neutral" facing="left" pointDir="left" talking={false} still={still} mirror />
      </button>
    );
  }

  const panelW = Math.min(PANEL_W, vw - 24);
  const align = panelAlign(x, panelW, vw);
  // The panel and its tail are placed with transforms only (the layout position never changes), so walking never shifts layout.
  const panelLeft = Math.min(Math.max(x + size.w - panelW, 12), Math.max(12, vw - panelW - 12));
  const tailX = Math.min(Math.max(x + size.w / 2 - panelLeft - 6, 14), panelW - 26);
  const moveTransition = dur && !still ? `transform ${dur}ms cubic-bezier(0.45, 0, 0.55, 1)` : "none";
  const controlsCopy = { ...ui };
  const controlState = { paused, voice, voiceAvailable, noRoam };
  const typingIndex = revealed - 1;

  return (
    <>
      {letterEl}
      {peekSpot && <SectionPeek key={peekSpot.key} spot={peekSpot} onEnd={endPeek} />}
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
              {!flow.s.active && <Chips chips={choices} ready={chipsReady} label={ui.choicesLabel} onPick={onChip} />}
              {flow.s.active && <LeadFlow flow={flow} copy={M.lead} form={form} sla={sla} email={email} />}
              <Transcript
                entries={entries}
                open={transcriptOpen}
                onToggle={() => setTranscriptOpen((v) => !v)}
                copy={{ show: ui.transcriptShow, hide: ui.transcriptHide, label: ui.transcriptLabel, tween: ui.speakerTween, you: ui.speakerYou }}
              />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

