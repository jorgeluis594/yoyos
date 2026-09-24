# Company isolation with Prisma and PostgreSQL

`User.companyId` references a `Company` and can be `null` while the account completes registration. Authentication tables are global and do not have RLS. A shared resolver validates the Better Auth session and reads `User.companyId` with `systemPrisma`. The tenant route middleware under `/api` uses that ID, never one supplied by the client: it returns `401` without a session and `409` when the company is missing. Protected loaders and actions must use the same resolver and wrap their tenant queries in `withTenantIsolation(companyId, callback)`.

`POST /api/company` is outside the tenant middleware. An authenticated account without a company sends `{ "name": "Name" }`; the server trims whitespace, requires 1 to 120 characters, generates a UUID, and creates the company and user association in a transaction with `app.company_id` set. It returns `{ companyId }` with `201`. If the account is already associated, it returns `200` with the existing ID. If the association fails, company creation is rolled back, and registration can be retried from `/register` without creating another account. `/api/auth/*` is also outside the middleware.

`withTenantIsolation` stores the already authorized company in `AsyncLocalStorage` and does not open a transaction.

Repositories use `prisma` directly. Each model query or direct SQL query requires company context, opens a short transaction, sets `app.company_id` with `set_config(..., true)`, and commits before returning the result. This includes `$queryRaw`, `$executeRaw`, their `Unsafe` variants, and `Prisma.sql`; parameters are always preserved. Independent queries commit independently.

```ts
await withTenantIsolation(companyId, async () => {
  await prisma.company.update({ where: { id: companyId }, data: { name: "New" } });
  return withinTransaction(async () => {
    await saveOrder();
    await saveOrderDetails();
    return ok(null);
  });
});
```

`withinTransaction` groups operations on the same connection with a single company setting. It returns a failed `Result` after rollback and propagates exceptions and commit errors. A failed `Result` from a nested call or a caught technical error marks the entire block for rollback. Switching companies within the block fails and also marks it for rollback. `prisma.$transaction` is blocked: use `withinTransaction` for tenant operations.

`systemPrisma` is the base client for authentication and global queries: it does not require company context and retains the native transactions used by Better Auth. `prisma` requires company context for all its operations and sets `app.company_id` within each transaction. The database applies RLS to `Company` even when `systemPrisma` is used.

Migration `20260923150000_company_rls` applies `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` to `Company`. Its `USING` and `WITH CHECK` policy compares `id` with `NULLIF(current_setting('app.company_id', true), '')::uuid`. Without context, no rows can be read or written. The `core_app` role has only DML permissions on application tables, with no `TRUNCATE`, table ownership, superuser privileges, or `BYPASSRLS`. The `migrate` service uses migration credentials; `web` uses only the restricted role.

All persistence operations must be awaited within their context. A deferred task is not automatically part of a transaction that has already ended.
