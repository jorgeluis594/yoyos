import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, test } from "vitest";

test("courier catalog seed is idempotent by code and fails loudly on invalid files", async () => {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Seed tests require administrative test credentials");
  const dbName = `courier_seed_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const run = (file?: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-courier-catalog.ts"], {
      env: { ...process.env, DATABASE_URL: url.toString(), ...(file ? { COURIER_CATALOG_FILE: file } : {}) }, encoding: "utf8", timeout: 30_000,
    });
    const migrated = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60_000 });
    expect(migrated.status, migrated.stderr).toBe(0);
    await db.connect();
    const read = async () => (await db.query('SELECT id, code, name, enabled FROM "Courier" ORDER BY code')).rows;

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const seeded = await read();
    expect(seeded.map(({ code, name, enabled }) => ({ code, name, enabled }))).toEqual([
      { code: "olva", name: "Olva Courier", enabled: true },
      { code: "shalom", name: "Shalom", enabled: true },
    ]);
    expect(run().status).toBe(0);
    expect(await read()).toEqual(seeded);

    const dir = await mkdtemp(join(tmpdir(), "courier-seed-"));
    const renamed = join(dir, "renamed.json");
    await writeFile(renamed, JSON.stringify([{ code: "olva", name: "Olva", enabled: false }]));
    expect(run(renamed).status).toBe(0);
    expect(await read()).toEqual(seeded.map((row) => row.code === "olva" ? { ...row, name: "Olva", enabled: false } : row));

    for (const [name, content] of [["malformed", "{"], ["duplicate", JSON.stringify([{ code: "a", name: "A", enabled: true }, { code: "a", name: "B", enabled: true }])],
      ["badcode", JSON.stringify([{ code: "Bad Code", name: "A", enabled: true }])]] as const) {
      const file = join(dir, `${name}.json`);
      await writeFile(file, content);
      const failed = run(file);
      expect(failed.status, name).toBe(1);
      expect(failed.stdout).toContain('"event":"courier_catalog_seed_failed"');
    }
    expect((await read()).map((row) => row.code)).toEqual(["olva", "shalom"]);
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
});
