import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

const databaseName = "yoyos-whatsapp.db";
const keyName = "yoyos_whatsapp_database_key_v1";

let opening: Promise<SQLite.SQLiteDatabase> | undefined;

export function openWhatsAppDatabase(): Promise<SQLite.SQLiteDatabase> {
  opening ??= open().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  let key = await SecureStore.getItemAsync(keyName);
  if (key === null) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await SecureStore.setItemAsync(keyName, key);
  }
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid WhatsApp database key");

  const database = await SQLite.openDatabaseAsync(databaseName);
  try {
    await database.execAsync(`PRAGMA key = "x'${key}'"`);
    const cipher = await database.getFirstAsync<{ cipher_version: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) throw new Error("WhatsApp database requires SQLCipher");

    const version = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    if (!version || ![0, 1].includes(version.user_version)) throw new Error("Unsupported WhatsApp database schema");
    if (version.user_version === 0) {
      await database.execAsync(`BEGIN IMMEDIATE;
        CREATE TABLE whatsapp_auth_entries (
          tenant_id TEXT NOT NULL,
          account_key TEXT NOT NULL,
          category TEXT NOT NULL,
          key_id TEXT NOT NULL,
          ciphertext BLOB NOT NULL,
          nonce BLOB NOT NULL,
          tag BLOB NOT NULL,
          key_version INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, account_key, category, key_id)
        );
        CREATE TABLE whatsapp_outbox (
          event_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          account_key TEXT NOT NULL,
          generation INTEGER NOT NULL,
          ciphertext BLOB NOT NULL,
          nonce BLOB NOT NULL,
          tag BLOB NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued', 'chat_confirmed', 'metadata_accepted', 'media_uploaded', 'confirmed', 'rejected')),
          chat_id TEXT,
          message_id TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          file_path TEXT,
          sha256 TEXT,
          PRIMARY KEY (tenant_id, account_key, event_id)
        );
        CREATE INDEX whatsapp_outbox_ready ON whatsapp_outbox (tenant_id, account_key, state, next_attempt_at);
        PRAGMA user_version = 1;
        COMMIT;`);
    }
    return database;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}
