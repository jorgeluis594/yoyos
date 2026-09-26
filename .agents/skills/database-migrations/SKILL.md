---
name: database-migrations
description: Generate and review database migrations when adding, changing, or removing tables, columns, indexes, constraints, or tenant RLS policies. Enforces Prisma CLI-generated migration files, avoids prolonged table locks, and preserves tenant isolation.
---

# Database Migrations

All paths below are relative to the repository root.

1. Review the schema and migrations in `apps/core/prisma`. Update `schema.prisma` when needed.
2. From `apps/core`, with a development `DATABASE_URL` and migration credentials, generate the file:

   ```sh
   pnpm exec prisma migrate dev --create-only --name descriptive_name
   ```

   **Never create migration directories or files manually or invent timestamps.** For SQL-only changes, generate an empty migration with the same command. Edit the generated SQL before applying it; do not modify migrations already applied in shared environments.
3. Review and adapt the SQL to avoid prolonged table locks. Choose the approach based on the operation and existing data; separate bulk work from DDL and bound lock waits.
4. If the change affects a tenant table, follow the next section.
5. Apply in development and regenerate the client:

   ```sh
   pnpm exec prisma migrate dev
   pnpm exec prisma generate
   ```

   Review the result with existing data and version the changes. Do not accept resets when data must be preserved.
6. For a requested deployment, use `pnpm exec prisma migrate deploy`. The `migrate` service in `compose.yaml` already runs it and provisions permissions. Follow the procedure in `README.md`; on failure, inspect the state before retrying.

## Tables with Tenant Isolation

- Add a UUID `companyId` and its relation to `Company`. For existing data, populate each row's actual company before enforcing `NOT NULL`. For `Company`, isolation uses its own `id`.
- For tenant-owned tables, declare `companyId` with `@default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid"))` in `schema.prisma` and confirm the generated migration sets the same column default. PostgreSQL normalizes this expression when introspected; matching its form avoids repeated Prisma diffs. Inserts can then omit `companyId`; the transaction context supplies it, and the RLS `WITH CHECK` policy still rejects a different value supplied explicitly.
- Add the column default and the table's policies to the generated SQL. For a new table, create it and configure RLS in the same short transaction before granting access. Example for `Order`:

  ```sql
  ALTER TABLE "Order" ALTER COLUMN "companyId" SET DEFAULT NULLIF(current_setting('app.company_id', true), '')::uuid;
  ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
  CREATE POLICY order_company_isolation ON "Order"
    USING ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid)
    WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), '')::uuid);
  ```

- Include the company in uniqueness constraints scoped to a tenant and in relationships between tenant entities. Filter backfills explicitly by company; the administrative role can bypass RLS. Do not disable policies.
- Update DML permissions and ownership checks in `apps/core/scripts/provision-role.sql`; keep `core_app` without table ownership or `BYPASSRLS`.
- Reuse the mechanism described in `docs/rls-with-prisma.md`. **Do not add table-specific logic to the isolation module or require isolation tests for each new table.**
