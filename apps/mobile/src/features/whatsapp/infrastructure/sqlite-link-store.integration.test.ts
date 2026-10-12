import { createSqliteLinkStore } from "@mobile/features/whatsapp/infrastructure/sqlite-link-store";
import { createLocalSql } from "@mobile/features/whatsapp/infrastructure/local-sql";
import { migrateWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";
import type { CompanyId, UserId } from "@mobile/features/whatsapp/domain/ids";

const company = "company-1" as CompanyId;
const user = "user-1" as UserId;

async function setup() {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  let counter = 0;
  return { database, links: createSqliteLinkStore(createLocalSql(database), () => `link-${++counter}`) };
}

test("start fails while another link is active", async () => {
  const { database, links } = await setup();
  expect(await links.start(company, user, new Date(1))).toMatchObject({ success: true, data: { id: "link-1", companyId: company, accountId: null, endedAt: null } });
  expect(await links.start(company, user, new Date(2))).toMatchObject({ success: false, error: { code: "LOCAL_STORAGE_FAILED" } });
  expect(await links.all()).toMatchObject({ data: [{ id: "link-1" }] });
  database.close();
});

test("end closes the active link and allows starting a new one", async () => {
  const { database, links } = await setup();
  await links.start(company, user, new Date(1));
  expect(await links.end("link-1" as never, new Date(5))).toEqual({ success: true, data: undefined });
  expect(await links.active()).toEqual({ success: true, data: null });
  expect(await links.start(company, user, new Date(6))).toMatchObject({ success: true, data: { id: "link-2" } });
  expect(await links.all()).toMatchObject({ data: [{ id: "link-1", endedAt: new Date(5) }, { id: "link-2", endedAt: null }] });
  database.close();
});

test("rejects assigning the same account to two links", async () => {
  const { database, links } = await setup();
  await links.start(company, user, new Date(1));
  await links.end("link-1" as never, new Date(2));
  await links.start(company, user, new Date(3));
  await database.runAsync("UPDATE whatsapp_links SET account_id = '1@lid' WHERE id = 'link-1'", []);
  await expect(database.runAsync("UPDATE whatsapp_links SET account_id = '1@lid' WHERE id = 'link-2'", [])).rejects.toThrow();
  database.close();
});

test("rejects an account id that is not a LID", async () => {
  const { database, links } = await setup();
  await links.start(company, user, new Date(1));
  await expect(database.runAsync("UPDATE whatsapp_links SET account_id = '1@s.whatsapp.net' WHERE id = 'link-1'", [])).rejects.toThrow();
  database.close();
});
