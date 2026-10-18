"use client";

import { useCallback, useState } from "react";
import { loadFaceCardAction, retireFaceAction } from "@/app/(app)/brand/face-actions";
import { alertClass, errorClass, hintClass, linkButton, outlineButton, pickCardClass } from "@/components/ui";
import { activeOf, draftOf, type CardFace, type FaceCardData } from "@/lib/faces/card-types";
import { CHARACTER_LABELS } from "@/lib/characters/types";
import { FACE_KINDS, faceKindAllowed, type FaceKind } from "@/lib/faces/types";
import { s } from "@/lib/i18n/strings";
import type { TweenColors } from "@/lib/mascot/colors";
import { CharacterPicker, type CharacterGallery } from "./character-picker";
import { FaceActive } from "./face-active";
import { FaceDescribe } from "./face-describe";
import { FaceMake } from "./face-make";
import { FaceOwner } from "./face-owner";
import { MascotCard } from "./mascot-card";

const t = s.faces.card;

export interface MascotProps {
  reason: "regulated" | "formal" | "ok";
  active: { id: string; name: string } | null;
  inPosts: boolean;
  colors?: TweenColors;
  /** The characters drawn by the server in the brand colours (CH-3); without it the card is the older Tween-only card. */
  gallery?: CharacterGallery;
}

const STEPS = ["describe", "look", "sheet", "poses", "use"] as const;

/** Which step of making a face the draft is at (for the steps line). */
function stepOf(face: NonNullable<ReturnType<typeof draftOf>>): (typeof STEPS)[number] {
  if (face.kind === "owner_photo") return face.consent?.confirmed ? "poses" : "describe";
  if (!face.masterUrl) return "look";
  if (!face.sheetUrl) return "sheet";
  return "poses";
}

/**
 * The "Brand face" card on the Brand page (F-4): one card, shown step by step. Choose a kind; describe it; see the price;
 * pick a look; approve the sheet and each pose; use it. Tween (the mascot) keeps the card it had (the switch for posts, the
 * preview, the link to the mascot screen). An unfinished face is kept, so the owner can leave and come back.
 */
export function FaceCard({ brandId, initial, mascot }: { brandId: string; initial: FaceCardData; mascot: MascotProps }) {
  const [data, setData] = useState(initial);
  const [changing, setChanging] = useState(false);
  const [kind, setKind] = useState<FaceKind | null>(() => (mascot.inPosts && !activeOf(initial) ? "mascot" : null));
  const [error, setError] = useState<string | null>(null);
  const [startingOver, setStartingOver] = useState(false);

  const reload = useCallback(async () => {
    const r = await loadFaceCardAction();
    if (r.ok) setData(r.data);
    else setError(r.message);
  }, []);

  const draft = draftOf(data);
  const active = activeOf(data);
  const view = draft ? "work" : active && !changing ? "summary" : "choose";

  async function startOver() {
    if (!draft) return;
    setStartingOver(true);
    const r = await retireFaceAction(draft.id);
    if (!r.ok) setError(r.message);
    await reload();
    setKind(null);
    setStartingOver(false);
  }

  // The mascot kind: the character gallery (when a mascot may be used) above the older card with its "use in posts" switch.
  const mascotFace: CardFace | null = active?.kind === "mascot" ? active : (data.faces.find((f) => f.kind === "mascot" && f.status === "approved") ?? null);
  const canPick = mascot.gallery !== undefined && mascot.reason !== "regulated" && (mascot.reason === "ok" || mascot.active !== null);
  const mascotOn = active?.kind === "mascot" ? data.inPosts : mascot.inPosts;
  const mascotBlock = () => {
    const g = mascot.gallery;
    if (!g || !canPick) return <MascotCard brandId={brandId} {...mascot} />;
    const character = mascotFace?.character ?? g.selected;
    const ownName = mascotFace && mascotFace.name !== CHARACTER_LABELS[character] ? mascotFace.name : mascotFace ? "" : g.name;
    const gallery: CharacterGallery = { ...g, selected: character, name: ownName, poses: character === g.selected ? g.poses : [] };
    return (
      <div className="space-y-4">
        <CharacterPicker gallery={gallery} inPosts={mascotOn} onSaved={reload} />
        <MascotCard key={String(mascotOn)} brandId={brandId} {...mascot} inPosts={mascotOn} active={mascotFace ? { id: mascotFace.id, name: mascotFace.name } : mascot.active} hideTween />
      </div>
    );
  };

  const notAllowed = (k: FaceKind): string | null => {
    if (k === "mascot") return mascot.reason === "regulated" && !mascot.active ? t.notAllowed.mascot : null;
    return faceKindAllowed(k, data.regulated) ? null : t.notAllowed.photoreal;
  };

  return (
    <div className="space-y-4" data-face-view={view}>
      <p className="text-[14px] leading-5 text-desc">{t.intro}</p>

      {view === "choose" && (
        <div className="space-y-4">
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-ui text-title">{t.kindLegend}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FACE_KINDS.map((k) => {
                const why = notAllowed(k);
                return (
                  <label key={k} data-face-kind={k} data-disabled={why ? "true" : undefined} className={`${pickCardClass(kind === k)} ${why ? "cursor-not-allowed opacity-60" : ""}`}>
                    <input type="radio" name="face-kind" className="mt-0.5 shrink-0" checked={kind === k} disabled={why !== null} onChange={() => setKind(k)} />
                    <span className="min-w-0">
                      <span className="block text-ui text-title">{s.faces.kinds[k].label}</span>
                      <span className="mt-0.5 block break-words text-note text-desc">{why ?? t.kindHints[k]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {kind === "mascot" && mascotBlock()}
          {kind && kind !== "mascot" && (
            <>
              {kind === "photoreal" && (
                <p className={alertClass("info")} data-ai-note>
                  {t.aiNote}
                </p>
              )}
              <FaceDescribe key={kind} kind={kind} suggestions={kind === "photoreal" ? data.suggestions.photoreal : kind === "illustrated" ? data.suggestions.illustrated : []} onDone={reload} />
            </>
          )}
          {changing && (
            <button type="button" className={linkButton} onClick={() => setChanging(false)}>
              {t.cancel}
            </button>
          )}
        </div>
      )}

      {view === "work" && draft && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-card-title text-title">{draft.name}</h3>
              <p className="text-[14px] leading-5 text-desc">
                {s.faces.kinds[draft.kind].label} · {s.faces.status.draft}
              </p>
            </div>
            <ol className="flex flex-wrap gap-1 text-note text-desc" aria-label={t.stepsLabel}>
              {STEPS.map((st) => (
                <li key={st} aria-current={st === stepOf(draft) ? "step" : undefined} className={st === stepOf(draft) ? "font-medium text-title" : undefined}>
                  {t.steps[st]}
                  {st !== "use" ? " ›" : ""}
                </li>
              ))}
            </ol>
          </div>
          {draft.kind === "photoreal" && (
            <p className={alertClass("info")} data-ai-note>
              {t.aiNote}
            </p>
          )}
          {draft.kind === "owner_photo" ? (
            <FaceOwner face={draft} cutoutConfigured={data.cutoutConfigured} onChange={reload} />
          ) : (
            <FaceMake face={draft} brandId={brandId} onChange={reload} />
          )}
          <div>
            <button type="button" className={outlineButton} disabled={startingOver} onClick={() => void startOver()}>
              {startingOver ? t.starting : t.startOver}
            </button>
            <p className={`${hintClass} mt-1`}>{t.startOverHelp}</p>
          </div>
        </div>
      )}

      {view === "summary" && active && (
        <div className="space-y-4">
          {active.kind === "mascot" ? (
            <>
              {mascotBlock()}
              <button
                type="button"
                className={outlineButton}
                onClick={() => {
                  setChanging(true);
                  setKind(null);
                }}
              >
                {s.faces.card.active.change}
              </button>
            </>
          ) : (
            <FaceActive
              face={active}
              inPosts={data.inPosts}
              onChange={reload}
              onChoose={() => {
                setChanging(true);
                setKind(null);
              }}
            />
          )}
        </div>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
