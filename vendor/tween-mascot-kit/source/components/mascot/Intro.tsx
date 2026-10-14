"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { homeX, walkDuration } from "@/lib/mascot/motion";
import type { Dir, PointDir, TweenState } from "@/lib/mascot/machine";
import { faceFor } from "@/lib/mascot/machine";
import { TweenRig, squash } from "./TweenRig";

/**
 * First-visit intro on Home. Tween walks in, rummages in its scarf, pulls out a letter, tosses it onto the hero, then
 * walks under the wordmark and climbs up the page to sit on the header. A click or Escape skips straight to the end.
 * The intro owns its own rig; the docked Tween is not rendered until `onDone` runs.
 */
export type IntroCopy = { letterLabel: string; letterTitle: string; letterBody: string; letterCta: { label: string; href: string }; close: string };
type Size = { w: number; h: number; margin: number; bottom: number };

/** Hip height as a share of the rig's height (viewBox 12..474, hips at y 340). */
const HIP = (340 - 12) / 462;
const PERCH_SCALE = 0.5;
const LETTER_W = 56;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Where the letter lands: inside the first section of the page, right of centre, in that section's own coordinates. */
export type LetterSpot = { section: HTMLElement; x: number; y: number };

function findSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#main section") ?? document.querySelector<HTMLElement>("main section");
}

function letterTarget(): LetterSpot | null {
  const section = findSection();
  if (!section) return null;
  const r = section.getBoundingClientRect();
  const vh = window.innerHeight;
  const visibleBottom = Math.min(r.bottom, vh - 140);
  const x = Math.max(16, Math.min(r.width - LETTER_W - 24, r.width * 0.78));
  const y = Math.max(24, Math.min(visibleBottom - r.top - 60, (visibleBottom - r.top) * 0.62));
  return { section, x, y };
}

export function TweenIntro({ size, onLetter, onDone }: { size: Size; onLetter: (spot: LetterSpot) => void; onDone: (openPanel: boolean) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<TweenState>("walk");
  const [facing, setFacing] = useState<Dir>("left");
  const [pointDir, setPointDir] = useState<PointDir>("left");
  const [letter, setLetter] = useState<boolean | undefined>(undefined);
  const [flying, setFlying] = useState(false);
  const [perched, setPerched] = useState(false);
  /** Click on Tween: skips the intro, or (once Tween sits on the header) hops down and opens the chat. */
  const skipRef = useRef<(() => void) | null>(null);
  /** Escape: skips the intro, or (once Tween sits on the header) just sends Tween back to its corner. */
  const escRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let cancelled = false;
    let finished = false;
    let landed = false;
    let current: Animation | null = null;
    let leavePerch: (() => void) | null = null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { w, h } = size;
    const groundY = vh - size.bottom - h;
    const home = homeX(vw, w, size.margin);
    const rig = () => box.querySelector<SVGElement>("svg.tw-rig");
    const T = (x: number, y: number, s = 1) => `translate(${x}px, ${y}px) scale(${s})`;
    let pos = { x: vw + 12, y: groundY, s: 1 };
    box.style.transform = T(pos.x, pos.y);

    const move = async (to: { x: number; y: number; s?: number }, ms: number, mid?: Keyframe[]) => {
      const next = { x: to.x, y: to.y, s: to.s ?? pos.s };
      current = box.animate([{ transform: T(pos.x, pos.y, pos.s) }, ...(mid ?? []), { transform: T(next.x, next.y, next.s) }], { duration: ms, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "forwards" });
      pos = next;
      try {
        await current.finished;
      } catch {
        /* cancelled by a skip */
      }
      current?.commitStyles?.();
      current?.cancel();
      current = null;
    };

    const placeLetter = (spot: LetterSpot | null) => {
      if (landed) return;
      landed = true;
      setLetter(false);
      setFlying(false);
      if (spot) onLetter(spot);
    };

    const perchPoint = () => {
      const wm = document.querySelector<HTMLElement>("header [data-nav='home'] img") ?? document.querySelector<HTMLElement>("header [data-nav='home']");
      if (!wm) return null;
      const r = wm.getBoundingClientRect();
      if (r.width < 4) return null;
      const hipY = r.bottom - 2;
      const cx = Math.min(r.right + 6, vw - (w * PERCH_SCALE) / 2 - 4);
      return { x: cx - w / 2, y: hipY + (1 - HIP) * h * PERCH_SCALE - h, s: PERCH_SCALE };
    };

    const finish = (openPanel: boolean) => {
      if (finished) return;
      finished = true;
      onDone(openPanel);
    };

    // Leave the header: hop back down to the dock and hand over to the docked Tween.
    const climbDown = async (openPanel: boolean) => {
      if (finished) return;
      setPerched(false);
      setPose("celebrate");
      await move({ x: home, y: groundY, s: 1 }, 760, [{ offset: 0.3, transform: T(pos.x, pos.y - 30, pos.s) }]);
      setPose("idle");
      squash(rig(), "hard");
      await sleep(520);
      finish(openPanel);
    };

    const run = async () => {
      await sleep(400);
      if (cancelled) return;
      // 1. walk in from the right edge
      setPose("walk");
      setFacing("left");
      await move({ x: home, y: groundY }, walkDuration(pos.x, home));
      if (cancelled) return;
      setPose("idle");
      squash(rig(), "soft");
      await sleep(300);
      if (cancelled) return;
      // 2. rummage in the scarf, 3. pull the letter out
      setPose("reach");
      await sleep(950);
      if (cancelled) return;
      setPose("present");
      await sleep(1000);
      if (cancelled) return;
      // 4. toss it onto the page
      const spot = letterTarget();
      const fly = flyRef.current;
      if (spot && fly) {
        const br = box.getBoundingClientRect();
        const sx = br.left + br.width * 0.2;
        const sy = br.top + br.height * 0.05;
        const sr = spot.section.getBoundingClientRect();
        const tx = sr.left + spot.x;
        const ty = sr.top + spot.y;
        setLetter(false);
        setFlying(true);
        setPose("point");
        setPointDir("left");
        const peak = Math.min(sy, ty) - 120;
        const a = fly.animate(
          [
            { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(0.7)` },
            { offset: 0.5, transform: `translate(${(sx + tx) / 2}px, ${peak}px) rotate(-200deg) scale(1.1)` },
            { offset: 0.85, transform: `translate(${tx}px, ${ty - 10}px) rotate(-352deg) scale(1)` },
            { transform: `translate(${tx}px, ${ty}px) rotate(-366deg) scale(1)` },
          ],
          { duration: 1100, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)", fill: "forwards" },
        );
        try {
          await a.finished;
        } catch {
          /* skipped */
        }
        if (cancelled) return;
        placeLetter(spot);
        await sleep(700);
      } else placeLetter(null);
      if (cancelled) return;
      // 5. walk under the wordmark, 6. climb up the page onto the header
      const perch = perchPoint();
      if (!perch) {
        setPose("wave");
        await sleep(1200);
        finish(false);
        return;
      }
      setPose("walk");
      setFacing(perch.x < pos.x ? "left" : "right");
      await move({ x: perch.x, y: groundY }, walkDuration(pos.x, perch.x));
      if (cancelled) return;
      setPose("climb");
      const dist = groundY - perch.y;
      await move(perch, Math.max(1400, Math.min(3200, dist * 4.2)), [{ offset: 0.8, transform: T(perch.x, perch.y + 24, 0.62) }]);
      if (cancelled) return;
      // 7. sit on the header, legs swinging, until the visitor scrolls on, clicks Tween, or 8 s pass
      setPose("perch");
      setPerched(true);
      squash(rig(), "soft");
      const leave = () => {
        window.removeEventListener("scroll", onScroll);
        window.clearTimeout(timer);
        leavePerch = null;
      };
      leavePerch = leave;
      const onScroll = () => {
        if (window.scrollY > Math.max(320, vh * 0.6)) {
          leave();
          void climbDown(false);
        }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      const timer = window.setTimeout(() => {
        leave();
        void climbDown(false);
      }, 8000);
      skipRef.current = () => {
        leave();
        void climbDown(true);
      };
      escRef.current = () => {
        leave();
        void climbDown(false);
      };
    };

    // A click or Escape before Tween sits down skips the whole intro: the letter lands at once and Tween docks.
    skipRef.current = () => {
      cancelled = true;
      current?.finish();
      placeLetter(letterTarget());
      finish(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (escRef.current ?? skipRef.current)?.();
    };
    window.addEventListener("keydown", onKey);
    void run();
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      leavePerch?.();
      current?.cancel();
    };
    // the intro runs once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={boxRef} className="tw-intro" data-tween="intro" data-perched={perched ? "true" : "false"} style={{ width: size.w, height: size.h }}>
        <button type="button" className="tw-toggle" aria-label={perched ? "Talk to Tween" : "Skip Tween's intro"} onClick={() => skipRef.current?.()}>
          <TweenRig state={pose} face={faceFor(pose)} facing={facing} pointDir={pointDir} talking={false} still={false} letter={letter} />
        </button>
      </div>
      <div ref={flyRef} className="tw-fly" aria-hidden="true" style={{ visibility: flying ? "visible" : "hidden" }}>
        <LetterArt />
      </div>
    </>
  );
}

function LetterArt() {
  return (
    <svg viewBox="0 0 56 40" width={LETTER_W} height="40" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="52" height="36" rx="5" fill="#fff" stroke="#0B1C30" strokeWidth="3" />
      <path d="M4 5 L28 24 L52 5" fill="none" stroke="#0B1C30" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="28" cy="24" r="5.5" fill="#FF6B4A" />
    </svg>
  );
}

/** The letter Tween left on the page. It scrolls with the section it landed in and opens into a short note. */
export function PlacedLetter({ spot, copy }: { spot: LetterSpot; copy: IntroCopy }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const section = spot.section;
    if (getComputedStyle(section).position === "static") section.style.setProperty("position", "relative");
  }, [spot.section]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (gone) return null;
  const alignRight = spot.x > spot.section.clientWidth / 2;
  return createPortal(
    <div className="tw-letter-spot" data-tween="letter" style={{ left: spot.x, top: spot.y }}>
      <button ref={btnRef} type="button" className="tw-letter-btn" aria-expanded={open} aria-controls="tween-letter-note" aria-label={copy.letterLabel} onClick={() => setOpen((v) => !v)}>
        <LetterArt />
      </button>
      {open && (
        <div id="tween-letter-note" role="dialog" aria-label={copy.letterTitle} className="tw-note" data-align={alignRight ? "right" : "left"}>
          <p className="tw-title">{copy.letterTitle}</p>
          <p>{copy.letterBody}</p>
          <div className="tw-note-foot">
            <a className="tw-primary tw-note-cta" href={copy.letterCta.href}>
              {copy.letterCta.label}
            </a>
            <button
              type="button"
              className="tw-link"
              onClick={() => {
                setOpen(false);
                setGone(true);
              }}
            >
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </div>,
    spot.section,
  );
}
