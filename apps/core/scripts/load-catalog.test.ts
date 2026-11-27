import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, test } from "vitest";

const header = "id,courier,external_id,name,address,district_code,enabled";
const miraflores = "6f1c2f0e-4a53-4d0b-9a57-0d3f5b1e8c11";
const cayma = "7a2d3f1e-5b64-4e1c-8b68-1e4f6c2a9d22";

test("catalog load upserts couriers and agencies by id, idempotently and all or nothing", async () => {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Catalog load tests require administrative test credentials");
  const dbName = `catalog_load_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const migrated = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60_000 });
    expect(migrated.status, migrated.stderr).toBe(0);
    await db.connect();
    const dir = await mkdtemp(join(tmpdir(), "catalog-load-"));
    const load = async (csv: string) => {
      const file = join(dir, `${randomUUID()}.csv`);
      await writeFile(file, csv);
      return spawnSync(process.execPath, ["--import", "tsx", "scripts/load-catalog.ts"], {
        env: { ...process.env, DATABASE_URL: url.toString(), AGENCY_CATALOG_FILE: file }, encoding: "utf8", timeout: 30_000,
      });
    };
    const read = async () => (await db.query(`SELECT a.id, c.code AS courier, a.name, a.address, a."districtCode", a.enabled
      FROM "DeliveryAgency" a JOIN "Courier" c ON c.id = a."courierId" ORDER BY a.name`)).rows;

    const first = await load(`${header}\n${miraflores},shalom,2,MIRAFLORES,"AV. LARCO 1301, MIRAFLORES",150122,true\n${cayma},olva,9,CAYMA,AV. EJERCITO 1020,040103,true\n`);
    expect(first.status, first.stdout).toBe(0);
    expect(first.stdout).toContain('"inserted":2');
    const loaded = await read();
    expect(loaded).toEqual([
      { id: cayma, courier: "olva", name: "CAYMA", address: "AV. EJERCITO 1020", districtCode: "040103", enabled: true },
      { id: miraflores, courier: "shalom", name: "MIRAFLORES", address: "AV. LARCO 1301, MIRAFLORES", districtCode: "150122", enabled: true },
    ]);
    expect((await db.query('SELECT code FROM "Courier" ORDER BY code')).rows).toEqual([{ code: "olva" }, { code: "shalom" }]);

    const again = await load(`${header}\n${miraflores},shalom,2,MIRAFLORES,"AV. LARCO 1301, MIRAFLORES",150122,true\n${cayma},olva,9,CAYMA,AV. EJERCITO 1020,040103,true\n`);
    expect(again.stdout).toContain('"inserted":0,"updated":0');
    expect(await read()).toEqual(loaded);

    // A manual row outside the file stays as it is and is only reported.
    const manual = randomUUID();
    await db.query(`INSERT INTO "DeliveryAgency" (id, "courierId", name, address, "districtCode", enabled) SELECT $1, id, 'MANUAL', 'Av. 1', '150101', true FROM "Courier" WHERE code = 'shalom'`, [manual]);
    const changed = await load(`${header}\n${miraflores},shalom,2,MIRAFLORES LARCO,AV. LARCO 1302,150122,false\n${cayma},olva,9,CAYMA,AV. EJERCITO 1020,040103,true\n`);
    expect(changed.status, changed.stdout).toBe(0);
    expect(changed.stdout).toContain('"inserted":0,"updated":1');
    expect(changed.stdout).toContain(manual);
    expect((await read()).find((row) => row.id === miraflores)).toEqual({ id: miraflores, courier: "shalom", name: "MIRAFLORES LARCO", address: "AV. LARCO 1302", districtCode: "150122", enabled: false });
    expect((await read()).find((row) => row.id === manual)).toMatchObject({ name: "MANUAL", enabled: true });

    const before = await read();
    const invalid = await load(`${header}\n${miraflores},shalom,2,MIRAFLORES,AV. LARCO,150122,true\n${cayma},shalom,3,CAYMA,AV. EJERCITO,999999,true\n`);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain('"event":"catalog_load_failed"');
    expect(invalid.stdout).toContain("line 3");
    expect(await read()).toEqual(before);
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
});
