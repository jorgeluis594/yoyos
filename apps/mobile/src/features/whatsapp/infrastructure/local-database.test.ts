import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { openWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";

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
  expect(database.closeAsync).not.toHaveBeenCalled();
});
