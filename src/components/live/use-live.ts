"use client";

import { useEffect, useState } from "react";
import { watchDoc, watchKind, type LiveRecord, type LiveRecordOf } from "@/lib/realtime/browser";
import type { LiveKind } from "@/lib/realtime/types";

// State is keyed by what it was read for, so a change of brand or document never shows the previous one's data, and no
// state is set synchronously inside the effect.
interface DocState {
  key: string;
  live: boolean;
  doc: LiveRecord | null;
}
interface KindState<K extends LiveKind> {
  key: string;
  live: boolean;
  docs: LiveRecordOf<K>[];
}

const NO_DOCS: never[] = [];

/**
 * Listens to one live status document of the brand (`brands/{brandId}/live/{docId}`). `live` is true once Firestore has
 * answered, and false when live status is off, the token call failed or the listener gave up (then the screen works as it
 * always did). Stops listening when the component unmounts or the brand or document changes.
 */
export function useLiveDoc(brandId: string | null | undefined, docId: string | null | undefined): { live: boolean; doc: LiveRecord | null } {
  const key = brandId && docId ? `${brandId}/${docId}` : "";
  const [state, setState] = useState<DocState>({ key: "", live: false, doc: null });

  useEffect(() => {
    if (!brandId || !docId) return;
    const mine = `${brandId}/${docId}`;
    const stop = watchDoc(
      brandId,
      docId,
      (doc) => setState((prev) => ({ key: mine, live: prev.key === mine ? prev.live : false, doc })),
      (live) => setState((prev) => ({ key: mine, live, doc: prev.key === mine ? prev.doc : null })),
    );
    return stop;
  }, [brandId, docId]);

  return state.key === key && key !== "" ? { live: state.live, doc: state.doc } : { live: false, doc: null };
}

/**
 * Listens to every live status document of one `kind` for the brand. `live` and the cleanup work as in useLiveDoc.
 */
export function useLiveKind<K extends LiveKind>(brandId: string | null | undefined, kind: K): { live: boolean; docs: LiveRecordOf<K>[] } {
  const key = brandId ? `${brandId}/${kind}` : "";
  const [state, setState] = useState<KindState<K>>({ key: "", live: false, docs: NO_DOCS });

  useEffect(() => {
    if (!brandId) return;
    const mine = `${brandId}/${kind}`;
    const stop = watchKind(
      brandId,
      kind,
      (docs) => setState((prev) => ({ key: mine, live: prev.key === mine ? prev.live : false, docs: docs as LiveRecordOf<K>[] })),
      (live) => setState((prev) => ({ key: mine, live, docs: prev.key === mine ? prev.docs : NO_DOCS })),
    );
    return stop;
  }, [brandId, kind]);

  return state.key === key && key !== "" ? { live: state.live, docs: state.docs } : { live: false, docs: NO_DOCS };
}
