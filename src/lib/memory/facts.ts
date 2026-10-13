/**
 * Brand facts (Req 5, 11): every fact with its source, and the owner's add, edit and remove.
 * Everything runs as the signed-in user (row-level security), after an explicit membership
 * check. Facts are never deleted: "remove" sets active = false, and an edit of a fact that
 * did not come from the owner keeps the old row inactive and adds the owner's version.
 */
import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { MAX_ACTIVE_FACTS, parseFact, type FactFieldErrors, type FactInput, type FactKind, type FactSource, type FactView } from "./schema";

export class FactValidationError extends Error {
  constructor(public readonly fieldErrors: FactFieldErrors) {
    super("Fact is invalid");
    this.name = "FactValidationError";
  }
}

export class FactLimitError extends Error {
  constructor() {
    super("Too many facts");
    this.name = "FactLimitError";
  }
}

export class FactNotFoundError extends Error {
  constructor() {
    super("Fact not found");
    this.name = "FactNotFoundError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FactRow {
  id: string;
  kind: FactKind;
  label: string | null;
  value: string;
  source_type: FactSource;
  source_ref: string | null;
  source_quote: string | null;
  outcome_promise: boolean;
  origin_type: FactSource | null;
}

function toView(r: FactRow): FactView {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    value: r.value,
    sourceType: r.source_type,
    sourceRef: r.source_ref,
    sourceQuote: r.source_quote,
    outcomePromise: r.outcome_promise,
    // Only an owner row that points at another fact is an edit; the original may be inactive.
    editedFrom: r.source_type === "owner" && r.origin_type && r.origin_type !== "owner" ? r.origin_type : null,
  };
}

const SELECT = `
  select f.id, f.kind::text as kind, f.label, f.value, f.source_type::text as source_type, f.source_ref,
         f.source_quote, f.outcome_promise, o.source_type::text as origin_type
    from public.brand_facts f
    left join public.brand_facts o
      on f.source_type = 'owner' and o.brand_id = f.brand_id and o.id::text = f.source_ref`;

/** The brand's active facts, oldest first. Throws BrandAccessError for non-members. */
export async function listFacts(userId: string, brandId: string): Promise<FactView[]> {
  await requireBrandMember(userId, brandId);
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query<FactRow>(`${SELECT} where f.brand_id = $1 and f.active order by f.created_at asc, f.id asc`, [brandId]),
  );
  return rows.map(toView);
}

function checked(raw: unknown) {
  const parsed = parseFact(raw);
  if (!parsed.ok) throw new FactValidationError(parsed.fieldErrors);
  return parsed.data;
}

/** Adds a fact the owner typed (source "owner"). */
export async function addFact(userId: string, brandId: string, raw: FactInput | unknown): Promise<FactView> {
  await requireBrandMember(userId, brandId);
  const f = checked(raw);
  return getDb().withUser(userId, async (tx) => {
    const [count] = await tx.query<{ n: number }>("select count(*)::int as n from public.brand_facts where brand_id = $1 and active", [brandId]);
    if ((count?.n ?? 0) >= MAX_ACTIVE_FACTS) throw new FactLimitError();
    const [row] = await tx.query<{ id: string }>(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, created_by)
       values ($1, $2::public.fact_kind, $3, $4, 'owner', $5) returning id`,
      [brandId, f.kind, f.label || null, f.value, userId],
    );
    const [view] = await tx.query<FactRow>(`${SELECT} where f.id = $1 and f.brand_id = $2`, [row.id, brandId]);
    return toView(view);
  });
}

/**
 * Edits a fact. The owner's own facts change in place. A fact from the website, setup or an
 * upload stays as it was (inactive, with its source) and the edited version is added as an
 * owner fact whose source_ref is the original's id, so the page can say what it was edited from.
 * An edit that changes nothing writes nothing.
 */
export async function editFact(userId: string, brandId: string, factId: string, raw: FactInput | unknown): Promise<FactView> {
  await requireBrandMember(userId, brandId);
  const f = checked(raw);
  if (!UUID_RE.test(String(factId))) throw new FactNotFoundError();
  return getDb().withUser(userId, async (tx) => {
    const [cur] = await tx.query<{
      id: string;
      kind: FactKind;
      label: string | null;
      value: string;
      source_type: FactSource;
      outcome_promise: boolean;
    }>(
      `select id, kind::text as kind, label, value, source_type::text as source_type, outcome_promise
         from public.brand_facts where id = $1 and brand_id = $2 and active for update`,
      [factId, brandId],
    );
    if (!cur) throw new FactNotFoundError();

    const same = cur.kind === f.kind && (cur.label ?? "") === f.label && cur.value === f.value;
    let id = cur.id;
    if (!same) {
      if (cur.source_type === "owner") {
        await tx.query("update public.brand_facts set kind = $3::public.fact_kind, label = $4, value = $5 where id = $1 and brand_id = $2", [
          cur.id,
          brandId,
          f.kind,
          f.label || null,
          f.value,
        ]);
      } else {
        await tx.query("update public.brand_facts set active = false where id = $1 and brand_id = $2", [cur.id, brandId]);
        const [row] = await tx.query<{ id: string }>(
          `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, outcome_promise, created_by)
           values ($1, $2::public.fact_kind, $3, $4, 'owner', $5, $6, $7) returning id`,
          // The promise flag stays with the fact: an edit does not make a promise safe.
          [brandId, f.kind, f.label || null, f.value, cur.id, cur.outcome_promise, userId],
        );
        id = row.id;
      }
    }
    const [view] = await tx.query<FactRow>(`${SELECT} where f.id = $1 and f.brand_id = $2`, [id, brandId]);
    return toView(view);
  });
}

/** Removes a fact from use (active = false). The row stays for audit. Returns false when there is no such active fact. */
export async function removeFact(userId: string, brandId: string, factId: string): Promise<boolean> {
  await requireBrandMember(userId, brandId);
  if (!UUID_RE.test(String(factId))) return false;
  const rows = await getDb().withUser(userId, (tx) =>
    tx.query("update public.brand_facts set active = false where id = $1 and brand_id = $2 and active returning id", [factId, brandId]),
  );
  return rows.length > 0;
}
