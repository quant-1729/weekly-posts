-- A website or owner claim that promises a health, financial, legal or educational
-- result, or says "guaranteed" (Req 12). Kept as a fact with its source, but the
-- guardrail never lets posts repeat it for regulated businesses.
alter table public.brand_facts add column outcome_promise boolean not null default false;
