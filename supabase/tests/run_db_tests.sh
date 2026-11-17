#!/usr/bin/env bash
# Builds a throwaway database from schema.sql + every migration, then runs the
# RLS / attendance tests. Needs a local Postgres; set PGHOST/PGPORT/PGUSER.
set -euo pipefail
cd "$(dirname "$0")/.."
P="psql -v ON_ERROR_STOP=1 -q -X"
$P -d postgres -c "drop database if exists hazri_test" -c "create database hazri_test"
$P -d hazri_test -c "create extension if not exists pgcrypto" -f tests/supabase_shim.sql
grep -v "pg_cron\|cron\." schema.sql | $P -d hazri_test
for f in migrations/*.sql; do $P -d hazri_test -f "$f" >/dev/null; done
$P -d hazri_test -f tests/db_tests.sql >/dev/null
echo "ALL DATABASE TESTS PASSED"
