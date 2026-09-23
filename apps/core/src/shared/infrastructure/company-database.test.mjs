import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const appUrl = process.env.RLS_TEST_DATABASE_URL;

test("company RLS and transaction boundaries", { skip: !adminUrl || !appUrl ? "set RLS_TEST_ADMIN_URL and RLS_TEST_DATABASE_URL" : false }, async (t) => {
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  const role = new URL(appUrl).username.replaceAll('"', '""');
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";
  const success = (data = null) => ({ success: true, data });
  const failure = { success: false, error: { message: "expected failure" } };

  try {
    const [appRole] = await admin.$queryRaw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${new URL(appUrl).username}`;
    assert.deepEqual(appRole, { rolsuper: false, rolbypassrls: false });
    await admin.$executeRawUnsafe('DROP TABLE IF EXISTS public.rls_probe');
    await admin.$executeRawUnsafe('DROP TABLE IF EXISTS public.rls_parent');
    await admin.$executeRawUnsafe('CREATE TABLE public.rls_parent (id integer PRIMARY KEY)');
    await admin.$executeRawUnsafe('CREATE TABLE public.rls_probe (id text PRIMARY KEY, company_id uuid NOT NULL, parent_id integer REFERENCES public.rls_parent(id) DEFERRABLE INITIALLY DEFERRED)');
    await admin.$executeRawUnsafe('ALTER TABLE public.rls_probe ENABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE public.rls_probe FORCE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe(`CREATE POLICY tenant ON public.rls_probe USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid)`);
    await admin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.rls_probe TO "${role}"`);

    process.env.DATABASE_URL = appUrl;
    const { prisma } = await import("./prisma.ts");
    const { withCompanyContext, withCompanyDatabase, withinTransaction } = await import("./company-database.ts");
    const rows = () => withCompanyDatabase(async (tx) => success(await tx.$queryRaw`SELECT id FROM public.rls_probe ORDER BY id`));
    const insert = (id, parentId = null) => withCompanyDatabase(async (tx, companyId) => {
      await tx.$executeRaw`INSERT INTO public.rls_probe (id, company_id, parent_id) VALUES (${id}, ${companyId}::uuid, ${parentId})`;
      return success();
    });

    await t.test("requires context and blocks direct access", async () => {
      await assert.rejects(rows(), /Company context is required/);
      assert.deepEqual(await prisma.$queryRaw`SELECT id FROM public.rls_probe`, []);
      await assert.rejects(prisma.$executeRaw`INSERT INTO public.rls_probe (id, company_id) VALUES ('no-context', ${companyA}::uuid)`);
    });

    await t.test("isolates concurrent and nested company contexts", async () => {
      await Promise.all([
        withCompanyContext(companyA, async () => { await Promise.resolve(); await insert("a"); }),
        withCompanyContext(companyB, async () => { await Promise.resolve(); await insert("b"); }),
      ]);
      await withCompanyContext(companyA, async () => {
        assert.deepEqual((await rows()).data.map((row) => row.id), ["a"]);
        assert.deepEqual((await withCompanyDatabase(async (tx) => success(await tx.$queryRaw`SELECT count(*)::int AS count FROM public.rls_probe`))).data, [{ count: 1 }]);
        assert.deepEqual((await withCompanyDatabase(async (tx) => success(await tx.$queryRaw`UPDATE public.rls_probe SET id = 'changed' WHERE id = 'b' RETURNING id`))).data, []);
        assert.deepEqual((await withCompanyDatabase(async (tx) => success(await tx.$queryRaw`DELETE FROM public.rls_probe WHERE id = 'b' RETURNING id`))).data, []);
        await withCompanyContext(companyB, async () => assert.deepEqual((await rows()).data.map((row) => row.id), ["b"]));
        await assert.rejects(withCompanyContext(companyB, async () => { throw new Error("nested"); }), /nested/);
        assert.deepEqual((await rows()).data.map((row) => row.id), ["a"]);
      });
      await assert.rejects(withCompanyContext(companyA, () => withCompanyDatabase(async (tx) => {
        await tx.$executeRaw`INSERT INTO public.rls_probe (id, company_id) VALUES ('cross', ${companyB}::uuid)`;
        return success();
      })));
      await assert.rejects(withCompanyContext(companyA, () => withCompanyDatabase(async (tx) => {
        await tx.$executeRaw`UPDATE public.rls_probe SET company_id = ${companyB}::uuid WHERE id = 'a'`;
        return success();
      })));
    });

    await t.test("keeps independent operations and rolls back grouped failures", async () => {
      await withCompanyContext(companyA, async () => {
        await withinTransaction(async () => {
          const first = await withCompanyDatabase(async (tx) => success(await tx.$queryRaw`SELECT pg_backend_pid() AS pid`));
          const second = await withCompanyDatabase(async (tx) => success(await tx.$queryRaw`SELECT pg_backend_pid() AS pid`));
          assert.deepEqual(first.data, second.data);
          return success();
        });
        await insert("committed");
        assert.deepEqual(await withCompanyDatabase(async () => failure), failure);
        const grouped = await withinTransaction(async () => { await insert("rolled-back"); return failure; });
        assert.deepEqual(grouped, failure);
        await assert.rejects(withinTransaction(async () => {
          await insert("ignored-failure");
          await withinTransaction(() => failure);
          return success();
        }), /aborted by a nested operation/);
        await assert.rejects(withinTransaction(async () => {
          await insert("exception");
          throw new Error("technical failure");
        }), /technical failure/);
        await assert.rejects(withinTransaction(async () => {
          await insert("ignored-exception");
          try {
            await withinTransaction(() => { throw new Error("nested technical failure"); });
          } catch {
            // The outer transaction must still roll back.
          }
          return success();
        }), (error) => error.message.includes("aborted by a nested operation") && error.cause.cause.message === "nested technical failure");
        await assert.rejects(withinTransaction(async () => {
          await withCompanyContext(companyB, () => insert("wrong-company"));
          return success();
        }), /Cannot change company/);
        const ids = (await rows()).data.map((row) => row.id);
        assert(ids.includes("committed"));
        assert(!ids.some((id) => ["rolled-back", "ignored-failure", "exception", "ignored-exception", "wrong-company"].includes(id)));
        const concurrent = await Promise.allSettled([insert("parallel-ok"), insert("parallel-bad", 999)]);
        assert.equal(concurrent[0].status, "fulfilled");
        assert.equal(concurrent[1].status, "rejected");
        assert((await rows()).data.some((row) => row.id === "parallel-ok"));
      });
    });

    await t.test("propagates commit failure and clears transaction local setting", async () => {
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
      } finally {
        await pool.end();
      }
    });

  } finally {
    if (process.env.DATABASE_URL === appUrl) {
      const { prisma } = await import("./prisma.ts");
      await prisma.$disconnect();
    }
    await admin.$executeRawUnsafe('DROP TABLE IF EXISTS public.rls_probe');
    await admin.$executeRawUnsafe('DROP TABLE IF EXISTS public.rls_parent');
    await admin.$disconnect();
  }
});
