import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { execFileSync } from "node:child_process";

const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const appUrl = process.env.RLS_TEST_DATABASE_URL;

test("company context enforces RLS and transaction boundaries", async (t) => {
  assert(adminUrl && appUrl, "set RLS_TEST_ADMIN_URL and RLS_TEST_DATABASE_URL");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  const role = new URL(appUrl).username.replaceAll('"', '""');
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";
  const success = (data = null) => ({ success: true, data });
  const failure = { success: false, error: { message: "expected failure" } };
  let safeToClean = false;

  try {
    const [{ existingCompany, existingProbe, existingParent }] = await admin.$queryRaw`SELECT to_regclass('public."Company"')::text AS "existingCompany", to_regclass('public.rls_probe')::text AS "existingProbe", to_regclass('public.rls_parent')::text AS "existingParent"`;
    assert.equal(existingCompany ?? existingProbe ?? existingParent, null, "RLS tests require a dedicated empty database");
    safeToClean = true;
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: new URL("../../..", import.meta.url), env: { ...process.env, DATABASE_URL: adminUrl }, stdio: "pipe" });
    execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-v", `app_password=${new URL(appUrl).password}`, "-v", `dbname=${new URL(adminUrl).pathname.slice(1)}`, "-f", "scripts/provision-role.sql"], { cwd: new URL("../../..", import.meta.url), stdio: "pipe" });
    const [appRole] = await admin.$queryRaw`SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = ${new URL(appUrl).username}`;
    assert.deepEqual(appRole, { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    const [permissions] = await admin.$queryRaw`SELECT pg_has_role(${new URL(appUrl).username}, 'core', 'member') AS member, (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public."Company"'::regclass) AS owner`;
    assert.equal(permissions.member, false);
    assert.notEqual(permissions.owner, new URL(appUrl).username);
    const [{ relrowsecurity, relforcerowsecurity }] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public."Company"'::regclass`;
    assert(relrowsecurity && relforcerowsecurity);
    const policies = await admin.$queryRaw`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Company'`;
    assert(policies.some(({ policyname }) => policyname === "company_isolation"));
    await admin.$executeRawUnsafe('CREATE TABLE public.rls_parent (id integer PRIMARY KEY)');
    await admin.$executeRawUnsafe('CREATE TABLE public.rls_probe (id text PRIMARY KEY, company_id uuid NOT NULL, parent_id integer REFERENCES public.rls_parent(id) DEFERRABLE INITIALLY DEFERRED)');
    for (const table of ['rls_probe']) {
      await admin.$executeRawUnsafe(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    }
    await admin.$executeRawUnsafe(`CREATE POLICY tenant ON public.rls_probe USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid)`);
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.rls_probe TO "${role}"`);

    process.env.DATABASE_URL = appUrl;
    const { prisma, withCompanyContext, getCompanyId, withinTransaction, authPrisma } = await import("./prisma.ts");
    const rows = () => prisma.$queryRaw`SELECT id FROM public.rls_probe ORDER BY id`;
    const insert = (id, parentId = null) => prisma.$executeRaw`INSERT INTO public.rls_probe (id, company_id, parent_id) VALUES (${id}, ${getCompanyId()}::uuid, ${parentId})`;

    await t.test("requires context for model and raw operations", async () => {
      assert.throws(() => getCompanyId(), /Company context is required/);
      await assert.rejects(prisma.company.findMany(), /Company context is required/);
      await assert.rejects(rows(), /Company context is required/);
      await assert.rejects(authPrisma.company.findMany(), /authPrisma only permits/);
      await assert.rejects(authPrisma.$queryRaw`SELECT 1`, /authPrisma only permits/);
      await assert.rejects(authPrisma.$transaction((tx) => tx.company.findMany()), /authPrisma only permits/);
      assert.throws(() => prisma.$transaction([]), /Use withinTransaction/);
      const appPool = new pg.Pool({ connectionString: appUrl });
      try { await assert.rejects(appPool.query('TRUNCATE public."Company"'), /permission denied/); } finally { await appPool.end(); }
      await assert.rejects(prisma.$executeRaw`INSERT INTO public.rls_probe (id, company_id) VALUES ('no-context', ${companyA}::uuid)`);
    });

    await t.test("isolates concurrent and nested contexts across model and raw SQL", async () => {
      await Promise.all([
        withCompanyContext(companyA, async () => { await Promise.resolve(); await prisma.company.create({ data: { id: getCompanyId(), name: "A" } }); await insert("a"); }),
        withCompanyContext(companyB, async () => { await Promise.resolve(); await prisma.company.create({ data: { id: getCompanyId(), name: "B" } }); await insert("b"); }),
      ]);
      await withCompanyContext(companyA, async () => {
        assert.deepEqual((await prisma.company.findMany()).map(({ name }) => name), ["A"]);
        assert.deepEqual((await rows()).map(({ id }) => id), ["a"]);
        assert.equal(await prisma.company.count(), 1);
        assert.equal((await prisma.company.findUnique({ where: { id: companyB } })), null);
        await prisma.company.update({ where: { id: companyA }, data: { name: "A updated" } });
        assert.equal((await prisma.company.upsert({ where: { id: companyA }, update: { name: "A" }, create: { id: companyA, name: "unused" } })).name, "A");
        await assert.rejects(prisma.company.upsert({ where: { id: companyB }, update: { name: "wrong" }, create: { id: companyB, name: "wrong" } }));
        assert.equal(await prisma.company.updateMany({ where: { id: companyB }, data: { name: "wrong" } }).then(({ count }) => count), 0);
        assert.equal(await prisma.company.deleteMany({ where: { id: companyB } }).then(({ count }) => count), 0);
        assert.equal(await prisma.company.createMany({ data: [{ id: companyA, name: "duplicate" }], skipDuplicates: true }).then(({ count }) => count), 0);
        assert.deepEqual(await prisma.$queryRaw(Prisma.sql`SELECT name FROM public."Company" WHERE id = ${companyA}::uuid`), [{ name: "A" }]);
        assert.deepEqual(await prisma.$queryRawUnsafe('SELECT name FROM public."Company" WHERE id = $1::uuid', companyB), []);
        assert.equal(await prisma.$executeRawUnsafe('UPDATE public."Company" SET name = $1 WHERE id = $2::uuid', "A", companyA), 1);
        assert.deepEqual(await prisma.$queryRaw`UPDATE public.rls_probe SET id = 'changed' WHERE id = 'b' RETURNING id`, []);
        assert.deepEqual(await prisma.$queryRaw`DELETE FROM public.rls_probe WHERE id = 'b' RETURNING id`, []);
        await withCompanyContext(companyB, async () => assert.deepEqual((await rows()).map(({ id }) => id), ["b"]));
        await assert.rejects(withCompanyContext(companyB, async () => { throw new Error("nested"); }), /nested/);
        assert.deepEqual((await rows()).map(({ id }) => id), ["a"]);
        await assert.rejects(prisma.company.create({ data: { id: companyB, name: "cross" } }));
        await assert.rejects(prisma.$executeRaw`UPDATE public.rls_probe SET company_id = ${companyB}::uuid WHERE id = 'a'`);
      });
    });

    await t.test("commits independent operations and rolls back grouped failures", async () => {
      await withCompanyContext(companyA, async () => {
        await withinTransaction(async () => {
          const first = await prisma.$queryRaw`SELECT pg_backend_pid() AS pid, current_setting('app.company_id') AS company`;
          const second = await prisma.$queryRaw`SELECT pg_backend_pid() AS pid, current_setting('app.company_id') AS company`;
          assert.deepEqual(first, second);
          assert.equal(first[0].company, companyA);
          assert.equal(await prisma.company.count(), 1);
          return success();
        });
        await insert("committed");
        const grouped = await withinTransaction(async () => { await insert("rolled-back"); return failure; });
        assert.deepEqual(grouped, failure);
        await assert.rejects(withinTransaction(async () => {
          await insert("ignored-failure");
          await withinTransaction(() => failure);
          return success();
        }), /aborted by a nested operation/);
        await assert.rejects(withinTransaction(async () => { await insert("exception"); throw new Error("technical failure"); }), /technical failure/);
        await assert.rejects(withinTransaction(async () => {
          await insert("caught-error");
          try { await prisma.company.create({ data: { id: companyB, name: "wrong" } }); } catch { /* caller ignored a technical error */ }
          return success();
        }), /aborted by a nested operation/);
        await assert.rejects(withinTransaction(async () => { await withCompanyContext(companyB, () => insert("wrong-company")); return success(); }), /Cannot change company/);
        await assert.rejects(withinTransaction(async () => {
          await insert("caught-switch");
          try { withCompanyContext(companyB, () => success()); } catch { /* caller ignored a company switch */ }
          return success();
        }), /aborted by a nested operation/);
        const ids = (await rows()).map(({ id }) => id);
        assert(ids.includes("committed"));
        assert(!ids.some((id) => ["rolled-back", "ignored-failure", "exception", "caught-error", "wrong-company", "caught-switch"].includes(id)));
        const concurrent = await Promise.allSettled([insert("parallel-ok"), insert("parallel-bad", 999)]);
        assert.equal(concurrent[0].status, "fulfilled");
        assert.equal(concurrent[1].status, "rejected");
        assert((await rows()).some(({ id }) => id === "parallel-ok"));
      });
    });

    await t.test("does not report success on commit failure and clears local setting", async () => {
      await assert.rejects(withCompanyContext(companyA, () => insert("commit-fails", 999)));
      const pool = new pg.Pool({ connectionString: appUrl, max: 1 });
      try {
        for (const companyId of [companyA, companyB]) {
          await pool.query("BEGIN");
          await pool.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
          await pool.query(companyId === companyA ? "COMMIT" : "ROLLBACK");
          const { rows: [{ value }] } = await pool.query("SELECT current_setting('app.company_id', true) AS value");
          assert(!value);
        }
      } finally { await pool.end(); }
    });
  } finally {
    if (process.env.DATABASE_URL === appUrl) {
      const { prisma } = await import("./prisma.ts");
      await prisma.$disconnect();
    }
    if (safeToClean) {
      await admin.$executeRawUnsafe('DROP TABLE IF EXISTS public.rls_probe');
      await admin.$executeRawUnsafe('DROP TABLE IF EXISTS public.rls_parent');
    }
    await admin.$disconnect();
  }
});
