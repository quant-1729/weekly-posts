import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));

import { addUspAction, confirmUspHereAction, saveBriefAction } from "@/app/(app)/create/actions";
import { draftToInput, emptyDraft, selectNewUsp } from "@/lib/briefs/editor-state";
import { briefFromText } from "@/lib/briefs/from-text";
import { getBrief } from "@/lib/briefs/service";
import type { MockDb } from "@/lib/db/mock";
import { listUsps } from "@/lib/usps/service";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";

let db: MockDb;
let o: Owner;
const NOW = new Date("2026-10-14T12:00:00Z");
const blank = () => emptyDraft({ blocks: {}, language: "en", channels: ["instagram"] });

beforeAll(async () => {
  db = await openDb();
  o = await makeOwner(db, { name: "Corner Bakery", country: "GB", timezone: "Europe/London" });
});
afterAll(() => closeDb(db));
beforeEach(() => {
  session.user = { id: o.userId };
  revalidate.mockClear();
});

describe("a selling point added from the editor is used straight away", () => {
  it("becomes the main point when there is none, else an extra point while there is room", () => {
    expect(selectNewUsp(blank(), "new")).toMatchObject({ primaryUspId: "new", secondaryUspIds: [] });
    const withMain = { ...blank(), primaryUspId: "main" };
    expect(selectNewUsp(withMain, "new")).toMatchObject({ primaryUspId: "main", secondaryUspIds: ["new"] });
    const one = { ...withMain, secondaryUspIds: ["a"] };
    expect(selectNewUsp(one, "new").secondaryUspIds).toEqual(["a", "new"]);
    const full = { ...withMain, secondaryUspIds: ["a", "b"] };
    expect(selectNewUsp(full, "new")).toBe(full); // no room: it only joins the library
    expect(selectNewUsp(withMain, "main")).toBe(withMain);
  });

  it("the actions do not revalidate the page (that rebuilt the editor from the saved draft and lost the selection)", async () => {
    const added = await addUspAction(o.brandId, { kind: "custom", title: "Family run", details: {} });
    expect(added).toMatchObject({ ok: true, usp: { title: "Family run" } });
    if (!added.ok) return;
    const claim = await addUspAction(o.brandId, { kind: "quality", title: "Baked fresh", details: { claim: "Baked fresh" } });
    if (!claim.ok) throw new Error("expected ok");
    const confirmed = await confirmUspHereAction(o.brandId, claim.usp.id);
    expect(confirmed).toMatchObject({ ok: true, usp: { confirmed: true } });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("says why in words, and refuses a signed-out visitor", async () => {
    const bad = await addUspAction(o.brandId, { kind: "discount", title: "A discount", details: { on: "everything" } });
    expect(bad).toMatchObject({ ok: false, message: expect.any(String), fieldErrors: expect.any(Object) });
    session.user = null;
    expect(await addUspAction(o.brandId, { kind: "custom", title: "x", details: {} })).toMatchObject({ ok: false });
    expect(await confirmUspHereAction(o.brandId, "x")).toMatchObject({ ok: false });
  });

  it("suggestion to saved draft: describe, accept, and the draft autosaves with it as the main point", async () => {
    const text = "Diwali offer: 15% off all suit stitching till 31 October. Book on WhatsApp.";
    const r = await briefFromText(
      { userId: o.userId, brandId: o.brandId, text, now: NOW },
      {
        fixture: {
          post_type: "offer", primary_usp_id: "", secondary_usp_ids: [], cta: "book", blocks: [], starts_on: "", ends_on: "2026-10-31", language: "", questions: [],
          new_usp: [{ kind: "discount", title: "15% off suit stitching", quote: "15% off all suit stitching", fields: { percent: 15, on: "suit stitching" } }],
        },
      },
    );
    expect(r.newUsp).toMatchObject({ kind: "discount", title: "15% off suit stitching" });
    const before = (await listUsps(o.userId, o.brandId)).length;
    const added = await addUspAction(o.brandId, { kind: r.newUsp!.kind, title: r.newUsp!.title, details: r.newUsp!.details });
    if (!added.ok) throw new Error(added.message);
    expect((await listUsps(o.userId, o.brandId)).length).toBe(before + 1);

    // What the editor does: apply the description, then use the new point.
    const draft = selectNewUsp({ ...blank(), postType: r.brief.postType, cta: "book", endsOn: r.brief.endsOn ?? "" }, added.usp.id);
    expect(draft.primaryUspId).toBe(added.usp.id);
    const saved = await saveBriefAction(o.brandId, null, draftToInput(draft));
    expect(saved).toMatchObject({ ok: true, brief: { primaryUspId: added.usp.id, postType: "offer" } });
    if (saved.ok) expect((await getBrief(o.userId, o.brandId, saved.brief.id))?.uspSnapshot[0]).toMatchObject({ title: "15% off suit stitching", role: "primary" });
  });
});
