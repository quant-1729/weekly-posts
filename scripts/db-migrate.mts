// Applies the unapplied files in supabase/migrations/ to the Supabase project, and makes sure the
// private storage buckets exist. Everything runs in ONE transaction.
//
//   npm run db:migrate              trial run: applies, checks, then rolls back (nothing is kept)
//   npm run db:migrate -- --commit  applies and keeps it
//
// Needs SUPABASE_DB_URL (transaction pooler) from .env.local. Applied files are recorded in
// supabase_migrations.schema_migrations, the table the Supabase CLI uses, so the CLI can take over later.
// Prints file names and counts only, never connection details.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { BUCKETS } from '@/lib/storage/types';

const commit = process.argv.includes('--commit');
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set. Run through npm (it loads .env.local).');
  process.exit(1);
}

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await client.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  const done = new Set(
    (await client.query<{ version: string }>('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version),
  );

  let applied = 0;
  for (const f of files) {
    const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
    if (done.has(version)) {
      console.log('skip (already applied)', f);
      continue;
    }
    const sql = await readFile(path.join(dir, f), 'utf8');
    try {
      await client.query(sql);
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
    await client.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)', [
      version,
      [sql],
      rest.join('_'),
    ]);
    console.log('ok', f);
    applied++;
  }

  for (const b of BUCKETS) {
    await client.query('insert into storage.buckets (id, name, public) values ($1, $1, false) on conflict (id) do nothing', [b]);
  }
  console.log('buckets ok:', BUCKETS.join(', '));

  const t = await client.query<{ n: number; rls: number }>(
    `select count(*)::int as n, count(*) filter (where c.relrowsecurity)::int as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`,
  );
  console.log(`public tables: ${t.rows[0].n}, with RLS on: ${t.rows[0].rls}`);
  if (t.rows[0].n !== t.rows[0].rls) throw new Error('Some public tables have row-level security off.');

  await client.query(commit ? 'commit' : 'rollback');
  console.log(
    commit
      ? `COMMITTED (${applied} migration${applied === 1 ? '' : 's'} applied)`
      : `TRIAL RUN: rolled back, nothing kept (${applied} migration${applied === 1 ? '' : 's'} would be applied)`,
  );
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error('FAILED, rolled back:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
