import { expect, test } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const appUrl = process.env.DATABASE_URL;
const step = async (name, run) => {
  try { await run(); } catch (error) { throw new Error(name, { cause: error }); }
};

test("company context enforces RLS and transaction boundaries", async () => {
  expect(appUrl, "run sh scripts/run-tests.sh integration to prepare core_test").toBeTruthy();
  const adminUrl = new URL(appUrl);
  adminUrl.username = "core";
  adminUrl.password = "core";
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl.toString() }) });
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
    expect(appRole).toStrictEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    const [permissions] = await admin.$queryRaw`SELECT pg_has_role(${new URL(appUrl).username}, 'core', 'member') AS member, (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public."Company"'::regclass) AS owner`;
    expect(permissions.member).toBe(false);
    expect(permissions.owner).not.toBe(new URL(appUrl).username);
    const [{ relrowsecurity, relforcerowsecurity }] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public."Company"'::regclass`;
    expect(relrowsecurity && relforcerowsecurity).toBeTruthy();
    const policies = await admin.$queryRaw`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Company'`;
    expect(policies.some(({ policyname }) => policyname === "company_isolation")).toBeTruthy();
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
    await admin.$executeRawUnsafe(`CREATE TABLE ${schema}.rls_parent (id integer PRIMARY KEY)`);
    await admin.$executeRawUnsafe(`CREATE TABLE ${schema}.rls_probe (id text PRIMARY KEY, company_id uuid NOT NULL, parent_id integer REFERENCES ${schema}.rls_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
    await admin.$executeRawUnsafe(`ALTER TABLE ${schema}.rls_probe ENABLE ROW LEVEL SECURITY`);
    await admin.$executeRawUnsafe(`ALTER TABLE ${schema}.rls_probe FORCE ROW LEVEL SECURITY`);
    await admin.$executeRawUnsafe(`CREATE POLICY tenant ON ${schema}.rls_probe USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid)`);
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA ${schema} TO "${role}"`);
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.rls_probe TO "${role}"`);

    const { prisma, withTenantIsolation, getCompanyId, withinTransaction, systemPrisma } = await import("./persistance.ts");
    const { createCompanyForUser } = await import("../../features/companies/application/create-company-for-user.ts");
    const { companyRepository } = await import("../../features/companies/infrastructure/company-repository.ts");
    const rows = () => prisma.$queryRaw(Prisma.sql`SELECT id FROM ${probe} ORDER BY id`);
    const insert = (id, parentId = null) => prisma.$executeRaw(Prisma.sql`INSERT INTO ${probe} (id, company_id, parent_id) VALUES (${id}, ${getCompanyId()}::uuid, ${parentId})`);

    await step("requires context for model and raw operations", async () => {
      expect(() => getCompanyId()).toThrow(/Company context is required/);
      await expect(prisma.company.findMany()).rejects.toThrow(/Company context is required/);
      await expect(rows()).rejects.toThrow(/Company context is required/);
      await expect(prisma.user.findMany()).rejects.toThrow(/Company context is required/);
      expect(await systemPrisma.company.findMany()).toStrictEqual([]);
      expect(() => prisma.$transaction([])).toThrow(/Use withinTransaction/);
      const appPool = new pg.Pool({ connectionString: appUrl });
      try { await expect(appPool.query('TRUNCATE public."Company"')).rejects.toThrow(/permission denied/); } finally { await appPool.end(); }
      await expect(prisma.$executeRaw(Prisma.sql`INSERT INTO ${probe} (id, company_id) VALUES ('no-context', ${companyA}::uuid)`)).rejects.toThrow();
    });

    await step("isolates concurrent and nested contexts across model and raw SQL", async () => {
      await Promise.all([
        withTenantIsolation(companyA, async () => { await Promise.resolve(); await prisma.company.create({ data: { id: getCompanyId(), name: "A", country: "PE" } }); await insert("a"); }),
        withTenantIsolation(companyB, async () => { await Promise.resolve(); await prisma.company.create({ data: { id: getCompanyId(), name: "B", country: "US" } }); await insert("b"); }),
      ]);
      expect(await systemPrisma.company.findMany()).toStrictEqual([]);
      await withTenantIsolation(companyA, async () => {
        expect((await prisma.company.findMany()).map(({ name }) => name)).toStrictEqual(["A"]);
        expect((await rows()).map(({ id }) => id)).toStrictEqual(["a"]);
        expect(await prisma.company.count()).toBe(1);
        expect((await prisma.company.findUnique({ where: { id: companyB } }))).toBe(null);
        await expect(prisma.company.create({ data: { id: crypto.randomUUID(), name: "Invalid country", country: "ZZ" } })).rejects.toThrow();
        await prisma.company.update({ where: { id: companyA }, data: { name: "A updated" } });
        expect((await prisma.company.upsert({ where: { id: companyA }, update: { name: "A" }, create: { id: companyA, name: "unused", country: "PE" } })).name).toBe("A");
        await expect(prisma.company.upsert({ where: { id: companyB }, update: { name: "wrong" }, create: { id: companyB, name: "wrong", country: "PE" } })).rejects.toThrow();
        expect(await prisma.company.updateMany({ where: { id: companyB }, data: { name: "wrong" } }).then(({ count }) => count)).toBe(0);
        expect(await prisma.company.deleteMany({ where: { id: companyB } }).then(({ count }) => count)).toBe(0);
        expect(await prisma.company.createMany({ data: [{ id: companyA, name: "duplicate", country: "PE" }], skipDuplicates: true }).then(({ count }) => count)).toBe(0);
        expect(await prisma.$queryRaw(Prisma.sql`SELECT name FROM public."Company" WHERE id = ${companyA}::uuid`)).toStrictEqual([{ name: "A" }]);
        expect(await prisma.$queryRawUnsafe('SELECT name FROM public."Company" WHERE id = $1::uuid', companyB)).toStrictEqual([]);
        expect(await prisma.$executeRawUnsafe('UPDATE public."Company" SET name = $1 WHERE id = $2::uuid', "A", companyA)).toBe(1);
        expect(await prisma.$queryRaw(Prisma.sql`UPDATE ${probe} SET id = 'changed' WHERE id = 'b' RETURNING id`)).toStrictEqual([]);
        expect(await prisma.$queryRaw(Prisma.sql`DELETE FROM ${probe} WHERE id = 'b' RETURNING id`)).toStrictEqual([]);
        await withTenantIsolation(companyB, async () => expect((await rows()).map(({ id }) => id)).toStrictEqual(["b"]));
        await expect(withTenantIsolation(companyB, async () => { throw new Error("nested"); })).rejects.toThrow(/nested/);
        expect((await rows()).map(({ id }) => id)).toStrictEqual(["a"]);
        await expect(prisma.company.create({ data: { id: companyB, name: "cross", country: "PE" } })).rejects.toThrow();
        await expect(prisma.$executeRaw(Prisma.sql`UPDATE ${probe} SET company_id = ${companyB}::uuid WHERE id = 'a'`)).rejects.toThrow();
      });
    });

    await step("commits independent operations and rolls back grouped failures", async () => {
      await withTenantIsolation(companyA, async () => {
        await withinTransaction(async () => {
          const first = await prisma.$queryRaw`SELECT pg_backend_pid() AS pid, current_setting('app.company_id') AS company`;
          const second = await prisma.$queryRaw`SELECT pg_backend_pid() AS pid, current_setting('app.company_id') AS company`;
          expect(first).toStrictEqual(second);
          expect(first[0].company).toBe(companyA);
          expect(await prisma.company.count()).toBe(1);
          return success();
        });
        await insert("committed");
        const grouped = await withinTransaction(async () => { await insert("rolled-back"); return failure; });
        expect(grouped).toStrictEqual(failure);
        await expect(withinTransaction(async () => {
          await insert("ignored-failure");
          await withinTransaction(() => failure);
          return success();
        })).rejects.toThrow(/aborted by a nested operation/);
        await expect(withinTransaction(async () => { await insert("exception"); throw new Error("technical failure"); })).rejects.toThrow(/technical failure/);
        await expect(withinTransaction(async () => {
          await insert("caught-error");
          try { await prisma.company.create({ data: { id: companyB, name: "wrong", country: "PE" } }); } catch { /* caller ignored a technical error */ }
          return success();
        })).rejects.toThrow(/aborted by a nested operation/);
        await expect(withinTransaction(async () => { await withTenantIsolation(companyB, () => insert("wrong-company")); return success(); })).rejects.toThrow(/Cannot change company/);
        await expect(withinTransaction(async () => {
          await insert("caught-switch");
          try { withTenantIsolation(companyB, () => success()); } catch { /* caller ignored a company switch */ }
          return success();
        })).rejects.toThrow(/aborted by a nested operation/);
        const ids = (await rows()).map(({ id }) => id);
        expect(ids.includes("committed")).toBeTruthy();
        expect(ids.some((id) => ["rolled-back", "ignored-failure", "exception", "caught-error", "wrong-company", "caught-switch"].includes(id))).toBeFalsy();
        const concurrent = await Promise.allSettled([insert("parallel-ok"), insert("parallel-bad", 999)]);
        expect(concurrent[0].status).toBe("fulfilled");
        expect(concurrent[1].status).toBe("rejected");
        expect((await rows()).some(({ id }) => id === "parallel-ok")).toBeTruthy();
      });
    });

    await step("does not report success on commit failure and clears local setting", async () => {
      await expect(withTenantIsolation(companyA, async () => insert("commit-fails", 999))).rejects.toThrow(/ForeignKeyConstraintViolation/);
      const pool = new pg.Pool({ connectionString: appUrl, max: 1 });
      try {
        for (const companyId of [companyA, companyB]) {
          await pool.query("BEGIN");
          await pool.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
          await pool.query(companyId === companyA ? "COMMIT" : "ROLLBACK");
          const { rows: [{ value }] } = await pool.query("SELECT current_setting('app.company_id', true) AS value");
          expect(value).toBeFalsy();
        }
      } finally { await pool.end(); }
    });

    await step("links an authenticated user atomically and rolls back failed links", async () => {
      const userId = crypto.randomUUID();
      userIds.push(userId);
      await systemPrisma.user.create({ data: { id: userId, name: "Owner", email: `${userId}@example.test` } });
      expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: userId } })).companyId).toBe(null);
      try {
        const first = await createCompanyForUser(userId, "Owner company", "PE", companyRepository);
        expect(first.created).toBeTruthy();
        expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: userId } })).companyId).toBe(first.companyId);
        expect((await createCompanyForUser(userId, "Ignored company", "US", companyRepository)).companyId).toBe(first.companyId);
        await withTenantIsolation(first.companyId, async () => {
          expect(await prisma.company.findUniqueOrThrow({ where: { id: first.companyId }, select: { name: true, country: true } })).toStrictEqual({ name: "Owner company", country: "PE" });
        });

        const failedUserId = crypto.randomUUID();
        userIds.push(failedUserId);
        await systemPrisma.user.create({ data: { id: failedUserId, name: "Failure", email: `${failedUserId}@example.test` } });
        await admin.$executeRawUnsafe(`CREATE FUNCTION ${schema}.reject_company_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${failedUserId}' THEN RAISE EXCEPTION 'link rejected'; END IF; RETURN NEW; END $$`);
        await admin.$executeRawUnsafe(`CREATE TRIGGER reject_company_link BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_company_link()`);
        try {
          await expect(createCompanyForUser(failedUserId, "Rolled back", "BR", companyRepository)).rejects.toThrow(/link rejected/);
          expect((await admin.$queryRaw`SELECT count(*)::int AS count FROM "Company" WHERE name = 'Rolled back'`)[0].count).toBe(0);
          expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: failedUserId } })).companyId).toBe(null);
        } finally {
          await admin.$executeRawUnsafe('DROP TRIGGER reject_company_link ON "user"');
          await admin.$executeRawUnsafe(`DROP FUNCTION ${schema}.reject_company_link()`);
          await systemPrisma.user.delete({ where: { id: failedUserId } });
        }
      } finally {
        const user = await systemPrisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
        await systemPrisma.user.deleteMany({ where: { id: userId } });
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
