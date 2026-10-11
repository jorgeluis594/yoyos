import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { SqlDatabase } from "@mobile/features/whatsapp/infrastructure/local-sql";

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

    await migrateWhatsAppDatabase(database);
    return database;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}

const schemaV2 = `
  CREATE TABLE whatsapp_links (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    linked_by_user_id TEXT NOT NULL,
    account_id TEXT CHECK (account_id IS NULL OR account_id GLOB '[0-9]*@lid'),
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE UNIQUE INDEX whatsapp_links_one_active ON whatsapp_links ((1)) WHERE ended_at IS NULL;
  CREATE UNIQUE INDEX whatsapp_links_account ON whatsapp_links (account_id) WHERE account_id IS NOT NULL;
  CREATE TABLE whatsapp_messages (
    id TEXT PRIMARY KEY,
    link_id TEXT REFERENCES whatsapp_links(id),
    company_id TEXT,
    account_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    whatsapp_message_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
    sent_at INTEGER,
    arrival_seq INTEGER NOT NULL UNIQUE,
    stored_at INTEGER NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('text','image')),
    text TEXT,
    image_mime_type TEXT,
    image_size INTEGER,
    image_reference TEXT,
    sync_state TEXT NOT NULL CHECK (sync_state IN ('pending','synced','rejected','orphaned')),
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    core_message_id TEXT,
    sync_error_code TEXT,
    synced_at INTEGER,
    rejected_at INTEGER,
    CHECK ((content_type = 'text' AND text IS NOT NULL AND image_reference IS NULL)
        OR (content_type = 'image' AND image_reference IS NOT NULL)),
    CHECK ((link_id IS NULL) = (company_id IS NULL)),
    CHECK (sync_state <> 'orphaned' OR link_id IS NULL),
    CHECK (sync_state <> 'synced' OR core_message_id IS NOT NULL),
    CHECK (sync_state <> 'rejected' OR (sync_error_code IS NOT NULL AND rejected_at IS NOT NULL)),
    UNIQUE (account_id, chat_id, whatsapp_message_id)
  );
  CREATE INDEX whatsapp_messages_outbox ON whatsapp_messages (company_id, sync_state, next_attempt_at)
    WHERE sync_state = 'pending';
  CREATE INDEX whatsapp_messages_chat ON whatsapp_messages (company_id, chat_id, arrival_seq);
`;

const dropSchemaV1 = `
  DROP TABLE IF EXISTS whatsapp_outbox;
  DROP TABLE IF EXISTS whatsapp_auth_entries;
`;

/** Brings the schema to v2. Each upgrade is atomic: a failure rolls back and leaves `user_version` untouched. */
export async function migrateWhatsAppDatabase(database: Pick<SqlDatabase, "execAsync" | "getFirstAsync">): Promise<void> {
  const version = await database.getFirstAsync<{ user_version: number }>("PRAGMA user_version", []);
  if (!version || ![0, 1, 2].includes(version.user_version)) throw new Error("Unsupported WhatsApp database schema");
  if (version.user_version === 2) return;
  await database.execAsync("BEGIN IMMEDIATE");
  try {
    // v1 was designed for another stack and never written, so its tables are dropped rather than migrated.
    await database.execAsync(`${dropSchemaV1}${schemaV2}PRAGMA user_version = 2;`);
    await database.execAsync("COMMIT");
  } catch (error) {
    await database.execAsync("ROLLBACK");
    throw error;
  }
}
