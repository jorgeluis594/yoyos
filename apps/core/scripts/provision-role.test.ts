import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "vitest";

test("provisions existing and future tables without exposing migration history or new functions", async () => {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) throw new Error("Run sh scripts/run-tests.sh integration");
  const database = `yoyos_permissions_${randomUUID().replaceAll("-", "")}`;
  const isolatedAdminUrl = new URL(adminUrl);
  isolatedAdminUrl.pathname = `/${database}`;
  const isolatedAppUrl = new URL(appUrl);
  isolatedAppUrl.pathname = `/${database}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const isolated = new pg.Client({ connectionString: isolatedAdminUrl.toString() });
  const app = new pg.Client({ connectionString: isolatedAppUrl.toString() });
  const provision = () => execFileSync("psql", [isolatedAdminUrl.toString(), "-X", "-v", "ON_ERROR_STOP=1",
    "-v", "app_password=core_app_local", "-v", `dbname=${database}`, "-f", "scripts/provision-role.sql"],
  { stdio: "pipe" });

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    await isolated.connect();
    await isolated.query(`
      CREATE SCHEMA pgboss;
      CREATE TABLE public.existing (id integer);
      CREATE TABLE public._prisma_migrations (id integer);
    `);
    provision();
    await isolated.query(`
      BEGIN;
      CREATE TABLE public.future (company_id text, value integer);
      ALTER TABLE public.future ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.future FORCE ROW LEVEL SECURITY;
      CREATE POLICY company_isolation ON public.future
        USING (company_id = current_setting('app.company_id', true))
        WITH CHECK (company_id = current_setting('app.company_id', true));
      INSERT INTO public.future VALUES ('other-company', 99);
      CREATE FUNCTION public.private_function() RETURNS integer
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS 'SELECT 1';
      COMMIT;
    `);
    await app.connect();
    await app.query("INSERT INTO public.existing VALUES (1)");
    expect((await app.query("SELECT * FROM public.existing")).rows).toEqual([{ id: 1 }]);
    await app.query("SELECT set_config('app.company_id', 'my-company', false)");
    await app.query("INSERT INTO public.future VALUES ('my-company', 1)");
    await app.query("UPDATE public.future SET value = 2");
    expect((await app.query("SELECT * FROM public.future")).rows)
      .toEqual([{ company_id: "my-company", value: 2 }]);
    expect((await app.query("DELETE FROM public.future")).rowCount).toBe(1);
    await expect(app.query("INSERT INTO public.future VALUES ('other-company', 1)"))
      .rejects.toThrow(/row-level security/);
    await expect(app.query("TRUNCATE public.future")).rejects.toThrow(/permission denied/);
    await expect(app.query("SELECT * FROM public._prisma_migrations")).rejects.toThrow(/permission denied/);
    await expect(app.query("SELECT public.private_function()")).rejects.toThrow(/permission denied/);
    await isolated.query("GRANT EXECUTE ON FUNCTION public.private_function() TO core_app");
    provision();
    expect((await app.query("SELECT public.private_function() AS value")).rows).toEqual([{ value: 1 }]);
    expect((await app.query("SELECT * FROM public.existing")).rows).toEqual([{ id: 1 }]);
    await expect(app.query("SELECT * FROM public._prisma_migrations")).rejects.toThrow(/permission denied/);
  } finally {
    await app.end();
    await isolated.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
