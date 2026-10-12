import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";
import { migrateWhatsAppDatabase, openWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";

jest.mock("expo-crypto", () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn() }));

test("opens an encrypted WhatsApp database before creating the durable links and messages tables", async () => {
  const statements: string[] = [];
  const database = {
    execAsync: jest.fn(async (sql: string) => { statements.push(sql); }),
    getFirstAsync: jest.fn(async (sql: string) => sql === "PRAGMA cipher_version"
      ? { cipher_version: "4.6.1" } : { user_version: 0 }),
    closeAsync: jest.fn(),
  };
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  jest.mocked(Crypto.getRandomBytesAsync).mockResolvedValue(new Uint8Array(32).fill(10));
  jest.mocked(SQLite.openDatabaseAsync).mockResolvedValue(database as unknown as SQLite.SQLiteDatabase);

  expect(await openWhatsAppDatabase()).toBe(database);
  expect(await openWhatsAppDatabase()).toBe(database);
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("yoyos_whatsapp_database_key_v1", "0a".repeat(32));
  expect(statements[0]).toBe(`PRAGMA key = "x'${"0a".repeat(32)}'"`);
  expect(statements[1]).toBe("BEGIN IMMEDIATE");
  expect(statements[2]).toContain("CREATE TABLE whatsapp_messages");
  expect(statements[2]).toContain("CREATE TABLE whatsapp_links");
  expect(statements[3]).toBe("COMMIT");
  expect(statements[4]).toBe("BEGIN IMMEDIATE");
  expect(statements[5]).toContain("ADD COLUMN core_image_id");
  expect(statements[6]).toBe("COMMIT");
  expect(database.closeAsync).not.toHaveBeenCalled();
});

const columns = async (database: ReturnType<typeof openTestDatabase>) =>
  (await database.getAllAsync<{ name: string }>("PRAGMA table_info(whatsapp_messages)", [])).map((row) => row.name);
const userVersion = async (database: ReturnType<typeof openTestDatabase>) =>
  (await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version", []))?.user_version;

test("migrates v2 to v3 adding core_image_id without dropping tables", async () => {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  await database.execAsync("ALTER TABLE whatsapp_messages DROP COLUMN core_image_id; PRAGMA user_version = 2;");
  await database.runAsync("INSERT INTO whatsapp_links (id, company_id, linked_by_user_id, started_at) VALUES ('l', 'c', 'u', 1)", []);
  expect(await columns(database)).not.toContain("core_image_id");
  await migrateWhatsAppDatabase(database);
  expect(await columns(database)).toContain("core_image_id");
  expect(await userVersion(database)).toBe(3);
  expect(await database.getFirstAsync("SELECT id FROM whatsapp_links", [])).toMatchObject({ id: "l" });
  database.close();
});

test("creates v3 from an empty database", async () => {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  expect(await columns(database)).toContain("core_image_id");
  expect(await userVersion(database)).toBe(3);
  database.close();
});

test("rejects versions above 3", async () => {
  const database = openTestDatabase();
  await database.execAsync("PRAGMA user_version = 4");
  await expect(migrateWhatsAppDatabase(database)).rejects.toThrow("Unsupported WhatsApp database schema");
  database.close();
});
