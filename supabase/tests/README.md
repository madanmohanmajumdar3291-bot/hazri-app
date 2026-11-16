# Database tests

`run_db_tests.sh` builds a throwaway database on a local Postgres 15+ from
`../schema.sql` and every file in `../migrations/`, using `supabase_shim.sql`
for the parts of Supabase the schema relies on (roles, `auth.uid()`,
`storage.objects`). It then runs `db_tests.sql`, which raises on the first
failure.

    PGHOST=localhost PGUSER=postgres npm run test:db

`schema.sql` is a snapshot of production from 2026-10-30; re-dump it after
changing the live database so these tests keep matching production.
