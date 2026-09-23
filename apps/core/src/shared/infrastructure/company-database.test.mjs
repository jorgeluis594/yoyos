import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;

test("company context enforces RLS and transaction boundaries", async (t) => {
  assert(adminUrl && appUrl, "run pnpm test:integration to prepare core_test");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  const role = new URL(appUrl).username.replaceAll('"', '""');
  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const schema = `rls_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const probe = Prisma.raw(`${schema}.rls_probe`);
  const userIds = [];
  const success = (data = null) => ({ success: true, data });
  const failure = { success: false, error: { message: "expected failure" } };

  try {
    const [appRole] = await admin.$queryRaw`SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = ${new URL(appUrl).username}`;
    assert.deepEqual(appRole, { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    const [permissions] = await admin.$queryRaw`SELECT pg_has_role(${new URL(appUrl).username}, 'core', 'member') AS member, (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public."Company"'::regclass) AS owner`;
    assert.equal(permissions.member, false);
    assert.notEqual(permissions.owner, new URL(appUrl).username);
    const [{ relrowsecurity, relforcerowsecurity }] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public."Company"'::regclass`;
    assert(relrowsecurity && relforcerowsecurity);
    const policies = await admin.$queryRaw`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Company'`;
    assert(policies.some(({ policyname }) => policyname === "company_isolation"));
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
    await admin.$executeRawUnsafe(`CREATE TABLE ${schema}.rls_parent (id integer PRIMARY KEY)`);
    await admin.$executeRawUnsafe(`CREATE TABLE ${schema}.rls_probe (id text PRIMARY KEY, company_id uuid NOT NULL, parent_id integer REFERENCES ${schema}.rls_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
    await admin.$executeRawUnsafe(`ALTER TABLE ${schema}.rls_probe ENABLE ROW LEVEL SECURITY`);
    await admin.$executeRawUnsafe(`ALTER TABLE ${schema}.rls_probe FORCE ROW LEVEL SECURITY`);
    await admin.$executeRawUnsafe(`CREATE POLICY tenant ON ${schema}.rls_probe USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid)`);
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${schema} TO "${role}"`);
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.rls_probe TO "${role}"`);

    const { prisma, withTenantIsolation, getCompanyId, withinTransaction, authPrisma, createCompanyForUser } = await import("./persistance.ts");
    const rows = () => prisma.$queryRaw(Prisma.sql`SELECT id FROM ${probe} ORDER BY id`);
    const insert = (id, parentId = null) => prisma.$executeRaw(Prisma.sql`INSERT INTO ${probe} (id, company_id, parent_id) VALUES (${id}, ${getCompanyId()}::uuid, ${parentId})`);

    await t.test("requires context for model and raw operations", async () => {
      assert.throws(() => getCompanyId(), /Company context is required/);
      await assert.rejects(prisma.company.findMany(), /Company context is required/);
      await assert.rejects(rows(), /Company context is required/);
      await assert.rejects(authPrisma.company.findMany(), /authPrisma only permits/);
      await assert.rejects(authPrisma.$queryRaw`SELECT 1`, /authPrisma only permits/);
      await assert.rejects(authPrisma.$transaction((tx) => tx.company.findMany()), /authPrisma only permits/);
      await assert.rejects(prisma.user.findMany(), /Authentication models require authPrisma/);
      assert.throws(() => prisma.$transaction([]), /Use withinTransaction/);
      const appPool = new pg.Pool({ connectionString: appUrl });
      try { await assert.rejects(appPool.query('TRUNCATE public."Company"'), /permission denied/); } finally { await appPool.end(); }
      await assert.rejects(prisma.$executeRaw(Prisma.sql`INSERT INTO ${probe} (id, company_id) VALUES ('no-context', ${companyA}::uuid)`));
    });

    await t.test("isolates concurrent and nested contexts across model and raw SQL", async () => {
      await Promise.all([
        withTenantIsolation(companyA, async () => { await Promise.resolve(); await prisma.company.create({ data: { id: getCompanyId(), name: "A" } }); await insert("a"); }),
        withTenantIsolation(companyB, async () => { await Promise.resolve(); await prisma.company.create({ data: { id: getCompanyId(), name: "B" } }); await insert("b"); }),
      ]);
      await withTenantIsolation(companyA, async () => {
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
        assert.deepEqual(await prisma.$queryRaw(Prisma.sql`UPDATE ${probe} SET id = 'changed' WHERE id = 'b' RETURNING id`), []);
        assert.deepEqual(await prisma.$queryRaw(Prisma.sql`DELETE FROM ${probe} WHERE id = 'b' RETURNING id`), []);
        await withTenantIsolation(companyB, async () => assert.deepEqual((await rows()).map(({ id }) => id), ["b"]));
        await assert.rejects(withTenantIsolation(companyB, async () => { throw new Error("nested"); }), /nested/);
        assert.deepEqual((await rows()).map(({ id }) => id), ["a"]);
        await assert.rejects(prisma.company.create({ data: { id: companyB, name: "cross" } }));
        await assert.rejects(prisma.$executeRaw(Prisma.sql`UPDATE ${probe} SET company_id = ${companyB}::uuid WHERE id = 'a'`));
      });
    });

    await t.test("commits independent operations and rolls back grouped failures", async () => {
      await withTenantIsolation(companyA, async () => {
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
        await assert.rejects(withinTransaction(async () => { await withTenantIsolation(companyB, () => insert("wrong-company")); return success(); }), /Cannot change company/);
        await assert.rejects(withinTransaction(async () => {
          await insert("caught-switch");
          try { withTenantIsolation(companyB, () => success()); } catch { /* caller ignored a company switch */ }
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
      await assert.rejects(withTenantIsolation(companyA, async () => insert("commit-fails", 999)), /ForeignKeyConstraintViolation/);
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

    await t.test("links an authenticated user atomically and rolls back failed links", async () => {
      const userId = crypto.randomUUID();
      userIds.push(userId);
      await authPrisma.user.create({ data: { id: userId, name: "Owner", email: `${userId}@example.test` } });
      try {
        const first = await createCompanyForUser(userId, "Owner company");
        assert(first.created);
        assert.equal((await authPrisma.user.findUniqueOrThrow({ where: { id: userId } })).companyId, first.companyId);
        assert.equal((await createCompanyForUser(userId, "Ignored company")).companyId, first.companyId);
        await withTenantIsolation(first.companyId, async () => {
          assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: first.companyId } })).name, "Owner company");
        });

        const failedUserId = crypto.randomUUID();
        userIds.push(failedUserId);
        await authPrisma.user.create({ data: { id: failedUserId, name: "Failure", email: `${failedUserId}@example.test` } });
        await admin.$executeRawUnsafe(`CREATE FUNCTION ${schema}.reject_company_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${failedUserId}' THEN RAISE EXCEPTION 'link rejected'; END IF; RETURN NEW; END $$`);
        await admin.$executeRawUnsafe(`CREATE TRIGGER reject_company_link BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_company_link()`);
        try {
          await assert.rejects(createCompanyForUser(failedUserId, "Rolled back"), /link rejected/);
          assert.equal((await admin.$queryRaw`SELECT count(*)::int AS count FROM "Company" WHERE name = 'Rolled back'`)[0].count, 0);
          assert.equal((await authPrisma.user.findUniqueOrThrow({ where: { id: failedUserId } })).companyId, null);
        } finally {
          await admin.$executeRawUnsafe('DROP TRIGGER reject_company_link ON "user"');
          await admin.$executeRawUnsafe(`DROP FUNCTION ${schema}.reject_company_link()`);
          await authPrisma.user.delete({ where: { id: failedUserId } });
        }
      } finally {
        const user = await authPrisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
        await authPrisma.user.deleteMany({ where: { id: userId } });
        if (user?.companyId) {
          const id = user.companyId;
          await withTenantIsolation(id, async () => prisma.company.delete({ where: { id } }));
        }
      }
    });
  } finally {
    try {
      try {
        const users = await admin.user.findMany({ where: { id: { in: userIds } }, select: { companyId: true } });
        await admin.user.deleteMany({ where: { id: { in: userIds } } });
        await admin.company.deleteMany({ where: { id: { in: [companyA, companyB, ...users.map(({ companyId }) => companyId).filter(Boolean)] } } });
      } finally {
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      }
    } finally {
      await admin.$disconnect();
      if (process.env.DATABASE_URL === appUrl) {
        const { prisma } = await import("./persistance.ts");
        await prisma.$disconnect();
      }
    }
  }
});
