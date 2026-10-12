import { migrateWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";

const tables = async (database: ReturnType<typeof openTestDatabase>) =>
  (await database.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", [])).map((row) => row.name);
const version = async (database: ReturnType<typeof openTestDatabase>) =>
  (await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version", []))?.user_version;

const v1 = `CREATE TABLE whatsapp_auth_entries (tenant_id TEXT); CREATE TABLE whatsapp_outbox (event_id TEXT); PRAGMA user_version = 1;`;

test("upgrades a v1 database to v2 and drops the unused v1 tables", async () => {
  const database = openTestDatabase();
  await database.execAsync(v1);
  await migrateWhatsAppDatabase(database);
  expect(await tables(database)).toEqual(["whatsapp_links", "whatsapp_messages"]);
  expect(await version(database)).toBe(2);
  database.close();
});

test("creates the v2 schema on a new database", async () => {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  expect(await tables(database)).toEqual(["whatsapp_links", "whatsapp_messages"]);
  database.close();
});

test("opens an existing v2 database without changes", async () => {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  await database.runAsync("INSERT INTO whatsapp_links (id, company_id, linked_by_user_id, started_at) VALUES ('l', 'c', 'u', 1)", []);
  await migrateWhatsAppDatabase(database);
  expect(await database.getFirstAsync("SELECT id FROM whatsapp_links", [])).toMatchObject({ id: "l" });
  expect(await version(database)).toBe(2);
  database.close();
});

test("refuses to open a database with an unknown user_version", async () => {
  const database = openTestDatabase();
  await database.execAsync("PRAGMA user_version = 7");
  await expect(migrateWhatsAppDatabase(database)).rejects.toThrow("Unsupported WhatsApp database schema");
  database.close();
});

test("rolls back a failed upgrade and leaves user_version at 1", async () => {
  const database = openTestDatabase();
  // A pre-existing table with a v2 name makes the v2 creation fail after the v1 tables were dropped.
  await database.execAsync(`${v1} CREATE TABLE whatsapp_links (id TEXT);`);
  await expect(migrateWhatsAppDatabase(database)).rejects.toThrow();
  expect(await version(database)).toBe(1);
  expect(await tables(database)).toEqual(["whatsapp_auth_entries", "whatsapp_links", "whatsapp_outbox"]);
  database.close();
});
