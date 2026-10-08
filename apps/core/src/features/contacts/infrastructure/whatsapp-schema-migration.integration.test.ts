import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, test } from "vitest";

const migrations = fileURLToPath(new URL("../../../../prisma/migrations/", import.meta.url));
const core = fileURLToPath(new URL("../../../../", import.meta.url));
const schemaMigration = "20261008064129_adapt_chats_for_mobile_whatsapp";
const psql = (url: string, file: string) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "pipe" });

async function withDatabase(run: (db: pg.Client, url: string) => Promise<void>) {
  const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Migration test requires an isolated administrative database URL");
  const name = `wa_schema_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await db.connect();
    await run(db, url.toString());
  } finally {
    await db.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

async function replay(url: string, through: string) {
  for (const name of (await readdir(migrations)).filter((name) => /^\d/.test(name) && name <= through).sort())
    psql(url, `${migrations}${name}/migration.sql`);
}

async function constraint(db: pg.Client, sql: string, values: unknown[], expected: string) {
  try {
    await db.query(sql, values);
    throw new Error(`Expected ${expected} to reject the row`);
  } catch (error) {
    expect(error).toMatchObject({ code: "23514", constraint: expected });
  }
}

test("upgrades historical WhatsApp rows without changing values, links, or image outcomes", async () => {
  await withDatabase(async (db, url) => {
    const previous = (await readdir(migrations)).filter((name) => /^\d/.test(name) && name < schemaMigration).sort();
    for (const name of previous) psql(url, `${migrations}${name}/migration.sql`);
    const ids = Array.from({ length: 7 }, () => randomUUID());
    const [company, contact, chat, image, text, ready, failed] = ids;
    const at = "2026-09-24T12:34:56.789Z";
    await db.query('INSERT INTO "Company" (id, name, country) VALUES ($1,$2,$3)', [company, "Historical shop", "PE"]);
    await db.query('INSERT INTO "Contact" (id,"companyId",phone,name,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$5)', [contact, company, "+51987654321", "Ada", at]);
    await db.query('INSERT INTO "Chat" (id,"companyId","contactId","createdAt") VALUES ($1,$2,$3,$4)', [chat, company, contact, at]);
    await db.query('INSERT INTO "Image" (id,"companyId","storageKey","createdAt") VALUES ($1,$2,$3,$4)', [image, company, "private/ready-image", at]);
    const insert = 'INSERT INTO "ChatMessage" (id,"companyId","chatId","externalId",direction,source,type,text,caption,"sentAt","receivedAt","whatsappMediaId","imageId","imageStatus","imageFailureCode","imageFailureMessage") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,$15)';
    await db.query(insert, [text, company, chat, "cloud-text", "incoming", "contact", "text", "Hello 🌎", null, at, null, null, null, null, null]);
    await db.query(insert, [ready, company, chat, "cloud-ready", "incoming", "contact", "image", null, "Receipt", at, "media-ready", image, "ready", null, null]);
    await db.query(insert, [failed, company, chat, "cloud-failed", "incoming", "contact", "image", null, null, at, "media-failed", null, "failed", "MEDIA_UNAVAILABLE", "Expired"]);
    const before = {
      contacts: (await db.query('SELECT * FROM "Contact" ORDER BY id')).rows,
      chats: (await db.query('SELECT * FROM "Chat" ORDER BY id')).rows,
      images: (await db.query('SELECT * FROM "Image" ORDER BY id')).rows,
      messages: (await db.query('SELECT * FROM "ChatMessage" ORDER BY id')).rows,
    };
    psql(url, `${migrations}${schemaMigration}/migration.sql`);
    expect((await db.query('SELECT id,"companyId",phone,name,"createdAt","updatedAt" FROM "Contact"')).rows).toEqual(before.contacts);
    expect((await db.query('SELECT * FROM "Chat"')).rows).toEqual(before.chats);
    expect((await db.query('SELECT * FROM "Image"')).rows).toEqual(before.images);
    const after = (await db.query('SELECT * FROM "ChatMessage" ORDER BY id')).rows;
    expect(after.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["whatsappMessageId", "imageMimeType", "imageSize", "uploadedByUserId", "eventDispatchedAt"].includes(key))))).toEqual(before.messages);
    for (const row of after) expect(row).toMatchObject({ companyId: company, chatId: chat, whatsappMessageId: null, imageMimeType: null, imageSize: null, uploadedByUserId: null, eventDispatchedAt: null });
    expect(after.find((row) => row.id === ready)).toMatchObject({ imageId: image, imageStatus: "ready", caption: "Receipt" });
    expect(after.find((row) => row.id === failed)).toMatchObject({ imageId: null, imageStatus: "failed", imageFailureCode: "MEDIA_UNAVAILABLE", imageFailureMessage: "Expired" });
    expect(after.find((row) => row.id === text)).toMatchObject({ text: "Hello 🌎", imageStatus: null });
  });
});

test("fresh schema enforces identity and message variants with explicit NULL guards", async () => {
  await withDatabase(async (db, url) => {
    await replay(url, schemaMigration);
    const [company, contact, chat, image] = Array.from({ length: 4 }, () => randomUUID());
    await db.query('INSERT INTO "Company" (id,name,country) VALUES ($1,$2,$3)', [company, "Fresh shop", "PE"]);
    await db.query('INSERT INTO "Contact" (id,"companyId",phone,"whatsappAccountId","whatsappLid","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [contact, company, "+51987654321", "123@lid", "456@lid"]);
    await db.query('INSERT INTO "Chat" (id,"companyId","contactId") VALUES ($1,$2,$3)', [chat, company, contact]);
    await db.query('INSERT INTO "Image" (id,"companyId","storageKey") VALUES ($1,$2,$3)', [image, company, "ready-image"]);
    const contactSql = 'INSERT INTO "Contact" (id,"companyId",phone,"whatsappAccountId","whatsappLid","updatedAt") VALUES ($1,$2,$3,$4,$5,now())';
    for (const [phone, account, lid] of [[null, null, null], ["", null, null], [null, "123@lid", null], [null, null, "456@lid"], [null, "bad", "456@lid"], [null, "123@lid", "bad"]])
      await constraint(db, contactSql, [randomUUID(), company, phone, account, lid], "Contact_identity_check");
    await db.query(contactSql, [randomUUID(), company, null, "789@lid", "456@lid"]);
    const fields = ["type", "text", "caption", "whatsappMediaId", "imageId", "imageStatus", "imageFailureCode", "imageFailureMessage", "whatsappMessageId", "imageMimeType", "imageSize", "uploadedByUserId", "eventDispatchedAt"] as const;
    type MessageFields = Partial<Record<(typeof fields)[number], unknown>>;
    const messageSql = `INSERT INTO "ChatMessage" (id,"companyId","chatId","externalId",direction,source,"sentAt","receivedAt",${fields.map((field) => `"${field}"`).join(",")}) VALUES ($1,$2,$3,$4,'incoming','contact',now(),now(),${fields.map((_, index) => `$${index + 5}`).join(",")})`;
    const values = (message: MessageFields) => fields.map((field) => message[field] ?? null);
    const cloudText = { type: "text", text: "Cloud" };
    const cloudReady = { type: "image", caption: "Ready", whatsappMediaId: "media-ready", imageId: image, imageStatus: "ready" };
    const cloudFailed = { type: "image", whatsappMediaId: "media-failed", imageStatus: "failed", imageFailureCode: "MEDIA_UNAVAILABLE", imageFailureMessage: "Gone" };
    const mobileText = { type: "text", text: "Mobile", whatsappMessageId: "protocol-text", uploadedByUserId: "uploader" };
    const mobileImage = { type: "image", whatsappMessageId: "protocol-image", imageStatus: "metadata_only", imageMimeType: "image/jpeg", imageSize: "9007199254740991", uploadedByUserId: "uploader" };
    const insert = (id: string, externalId: string, message: MessageFields) => db.query(messageSql, [id, company, chat, externalId, ...values(message)]);
    for (const [index, message] of [cloudText, cloudReady, cloudFailed, mobileText, mobileImage].entries()) await insert(randomUUID(), `valid-${index}`, message);
    await insert(randomUUID(), "a".repeat(4096), { ...mobileText, text: "a".repeat(65536), whatsappMessageId: "a".repeat(512) });
    await insert(randomUUID(), "valid-max-caption", { ...mobileImage, caption: "a".repeat(65536), whatsappMessageId: "protocol-caption" });
    const cases: [string, MessageFields][] = [
      ["Cloud image missing status", { ...cloudReady, imageStatus: null }],
      ["Cloud image with mobile MIME", { ...cloudReady, imageMimeType: "image/jpeg" }],
      ["Cloud image with mobile size", { ...cloudReady, imageSize: "1" }],
      ["Cloud image with uploader", { ...cloudReady, uploadedByUserId: "uploader" }],
      ["Cloud image with dispatch marker", { ...cloudReady, eventDispatchedAt: new Date() }],
      ["mobile image missing status", { ...mobileImage, imageStatus: null }],
      ["mobile text with image status", { ...mobileText, imageStatus: "metadata_only" }],
      ["mobile text with caption", { ...mobileText, caption: "caption" }],
      ["mobile text with media ID", { ...mobileText, whatsappMediaId: "media" }],
      ["mobile text with image ID", { ...mobileText, imageId: image }],
      ["mobile text with failure code", { ...mobileText, imageFailureCode: "MEDIA_UNAVAILABLE" }],
      ["mobile text with failure message", { ...mobileText, imageFailureMessage: "Gone" }],
      ["mobile text with MIME", { ...mobileText, imageMimeType: "image/jpeg" }],
      ["mobile text with size", { ...mobileText, imageSize: "1" }],
      ["mobile text missing uploader", { ...mobileText, uploadedByUserId: null }],
      ["mobile image negative size", { ...mobileImage, imageSize: "-1" }],
      ["mobile image oversized", { ...mobileImage, imageSize: "9007199254740992" }],
      ["mobile image invalid MIME", { ...mobileImage, imageMimeType: "text/plain" }],
      ["mobile image empty caption", { ...mobileImage, caption: "" }],
      ["mobile image oversized caption", { ...mobileImage, caption: "a".repeat(65537) }],
      ["mobile protocol ID oversized", { ...mobileText, whatsappMessageId: "a".repeat(513) }],
      ["mobile text empty", { ...mobileText, text: "" }],
      ["mobile text over 65536 bytes", { ...mobileText, text: "a".repeat(65537) }],
    ];
    for (const [label, message] of cases) await constraint(db, messageSql, [randomUUID(), company, chat, label, ...values(message)], "ChatMessage_content_image_state_check");
    await constraint(db, messageSql, [randomUUID(), company, chat, "a".repeat(4097), ...values({ ...mobileText, whatsappMessageId: "other-protocol" })], "ChatMessage_content_image_state_check");
    expect((await db.query('SELECT count(*)::int AS count FROM "ChatMessage"')).rows).toEqual([{ count: 7 }]);
    const index = (await db.query("SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indexrelid = 'public.\"ChatMessage_cloud_external_id_key\"'::regclass")).rows[0].definition;
    expect(index).toContain('UNIQUE INDEX "ChatMessage_cloud_external_id_key"');
    expect(index).toContain('WHERE ("whatsappMessageId" IS NULL)');
    const diff = execFileSync("pnpm", ["exec", "prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"],
      { cwd: core, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    expect(diff.trim()).toBe("-- This is an empty migration.");

    const tables = ["Contact", "Chat", "ChatMessage"];
    const catalog = (await db.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
      EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
        AND p.qual LIKE '%companyId%' AND p.with_check LIKE '%companyId%') AS policy,
      pg_get_expr(a.adbin, a.adrelid) AS company_default
      FROM pg_class c JOIN pg_attribute col ON col.attrelid = c.oid AND col.attname = 'companyId'
      JOIN pg_attrdef a ON a.adrelid = c.oid AND a.adnum = col.attnum
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1) ORDER BY c.relname`, [tables])).rows;
    expect(catalog.map(({ relname }) => relname)).toEqual(["Chat", "ChatMessage", "Contact"]);
    for (const row of catalog) {
      expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policy: true });
      expect(row.company_default).toContain("app.company_id");
    }
    const foreignKeys = (await db.query(`SELECT conname FROM pg_constraint WHERE conrelid IN ('public."Chat"'::regclass, 'public."ChatMessage"'::regclass)
      AND contype = 'f' AND array_length(conkey, 1) = 2 ORDER BY conname`)).rows.map(({ conname }) => conname);
    expect(foreignKeys).toEqual(expect.arrayContaining(["Chat_companyId_contactId_fkey", "ChatMessage_companyId_chatId_fkey", "ChatMessage_companyId_imageId_fkey"]));

    execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-v", "app_password=core_app_local", "-v", `dbname=${new URL(url).pathname.slice(1)}`, "-f", `${core}scripts/provision-role.sql`], { stdio: "pipe" });
    const appUrl = new URL(process.env.DATABASE_URL!);
    appUrl.pathname = new URL(url).pathname;
    const app = new pg.Client({ connectionString: appUrl.toString() });
    await app.connect();
    try {
      expect((await db.query("SELECT has_table_privilege('core_app', 'public.\"Contact\"', 'INSERT') AS contact, has_table_privilege('core_app', 'public.\"Chat\"', 'INSERT') AS chat, has_table_privilege('core_app', 'public.\"ChatMessage\"', 'INSERT') AS message")).rows[0])
        .toEqual({ contact: true, chat: true, message: true });
      const otherCompany = randomUUID();
      await db.query('INSERT INTO "Company" (id,name,country) VALUES ($1,$2,$3)', [otherCompany, "Other shop", "PE"]);
      await app.query("SELECT set_config('app.company_id', $1, false)", [company]);
      const ownContact = randomUUID();
      const ownChat = randomUUID();
      const ownMessage = randomUUID();
      await app.query('INSERT INTO "Contact" (id,phone,"updatedAt") VALUES ($1,$2,now())', [ownContact, "+51911111111"]);
      await app.query('INSERT INTO "Chat" (id,"contactId") VALUES ($1,$2)', [ownChat, ownContact]);
      await app.query('INSERT INTO "ChatMessage" (id,"chatId","externalId",direction,source,type,text,"sentAt","receivedAt") VALUES ($1,$2,$3,\'incoming\',\'contact\',\'text\',\'ok\',now(),now())', [ownMessage, ownChat, "own-message"]);
      for (const [table, id] of [["Contact", ownContact], ["Chat", ownChat], ["ChatMessage", ownMessage]])
        expect((await db.query(`SELECT "companyId" FROM "${table}" WHERE id = $1`, [id])).rows[0].companyId).toBe(company);
      await expect(app.query('INSERT INTO "Contact" (id,"companyId",phone,"updatedAt") VALUES ($1,$2,$3,now())', [randomUUID(), otherCompany, "+51922222222"])).rejects.toMatchObject({ code: "42501" });
      await expect(app.query('INSERT INTO "Chat" (id,"companyId","contactId") VALUES ($1,$2,$3)', [randomUUID(), otherCompany, ownContact])).rejects.toMatchObject({ code: "42501" });
      await expect(app.query('INSERT INTO "ChatMessage" (id,"companyId","chatId","externalId",direction,source,type,text,"sentAt","receivedAt") VALUES ($1,$2,$3,$4,\'incoming\',\'contact\',\'text\',\'bad\',now(),now())', [randomUUID(), otherCompany, ownChat, "cross-tenant"])).rejects.toMatchObject({ code: "42501" });
      await app.query("SELECT set_config('app.company_id', $1, false)", [otherCompany]);
      expect((await app.query('SELECT id FROM "Contact" WHERE id = $1', [ownContact])).rows).toEqual([]);
      expect((await app.query('SELECT id FROM "Chat" WHERE id = $1', [ownChat])).rows).toEqual([]);
      await expect(app.query('INSERT INTO "Chat" (id,"contactId") VALUES ($1,$2)', [randomUUID(), ownContact])).rejects.toMatchObject({ code: "23503", constraint: "Chat_companyId_contactId_fkey" });
      await expect(app.query('INSERT INTO "ChatMessage" (id,"chatId","externalId",direction,source,type,text,"sentAt","receivedAt") VALUES ($1,$2,$3,\'incoming\',\'contact\',\'text\',\'bad\',now(),now())', [randomUUID(), ownChat, "cross-fk"])).rejects.toMatchObject({ code: "23503", constraint: "ChatMessage_companyId_chatId_fkey" });
      const otherContact = randomUUID();
      const otherChat = randomUUID();
      await app.query('INSERT INTO "Contact" (id,phone,"updatedAt") VALUES ($1,$2,now())', [otherContact, "+51933333333"]);
      await app.query('INSERT INTO "Chat" (id,"contactId") VALUES ($1,$2)', [otherChat, otherContact]);
      await expect(app.query('INSERT INTO "ChatMessage" (id,"chatId","externalId",direction,source,type,"sentAt","receivedAt","whatsappMediaId","imageId","imageStatus") VALUES ($1,$2,$3,\'incoming\',\'contact\',\'image\',now(),now(),\'media\',$4,\'ready\')', [randomUUID(), otherChat, "cross-image", image]))
        .rejects.toMatchObject({ code: "23503", constraint: "ChatMessage_companyId_imageId_fkey" });
    } finally {
      await app.end();
    }
  });
});
