# Backup and Recovery Plan

## 1. Objectives
- **RPO**: `<= 24 hours` (daily automated snapshots; `< 5 min` with managed PostgreSQL WAL PITR).
- **RTO**: `<= 30 minutes`.

## 2. Backup Execution
- Daily encrypted `pg_dump --format=custom --no-owner --no-acl` at `03:30 IST` stored off-host (`7` daily, `4` weekly, `3` monthly).
- Mandatory pre-migration snapshot prior to every `npx prisma migrate deploy`.
- **Important**: Ensure backups preserve PostgreSQL RLS policies, composite FKs, and custom database roles (`app_runtime` vs `migrator`) cleanly!

## 3. Restore Verification Drill
1. Restore dump into isolated test PostgreSQL DB (`pg_restore --clean --if-exists`).
2. Verify RLS policies remain enabled (`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tokens'`).
3. Boot app against restored DB, run `/api/health` and tenant-isolation smoke test.
