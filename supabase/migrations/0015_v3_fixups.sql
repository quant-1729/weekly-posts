-- Brings a database that ran an early draft of 0014 (local development only) up to 0014's final
-- form. On any database that ran the final 0014 every statement is a no-op.

alter table public.clicks add column if not exists source text not null default 'link' check (source in ('link', 'qr'));
alter table public.brand_memory add column if not exists details_seeded_at timestamptz;

-- The draft's UPI format check used {2,256}, which Postgres rejects at insert time (max 255).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.payment_ids'::regclass and pg_get_constraintdef(oid) like '%{2,256}%'
  loop
    execute format('alter table public.payment_ids drop constraint %I', c.conname);
    alter table public.payment_ids
      add constraint payment_ids_upi_format
      check (scheme <> 'upi' or address ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$');
  end loop;
end $$;
