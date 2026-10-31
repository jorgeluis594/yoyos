import { afterAll, expect, test } from "vitest";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

afterAll(() => systemPrisma.$disconnect());

type IndexRow = { indexname: string; indexdef: string; valid: boolean };
const indexesOf = (table: string) => systemPrisma.$queryRaw<IndexRow[]>`
  SELECT i.relname AS indexname, pg_get_indexdef(x.indexrelid) AS indexdef, x.indisvalid AS valid
  FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
  WHERE t.relname = ${table}`;
const definitions = async (table: string) => (await indexesOf(table)).map((row) => row.indexdef);

test("the OAuth provider tables have the indexes of the design", async () => {
  expect(await definitions("oauthClient")).toContainEqual(expect.stringContaining('CREATE UNIQUE INDEX "oauthClient_clientId_key"'));
  expect(await definitions("oauthClientResource")).toContainEqual(expect.stringMatching(/UNIQUE INDEX .* \("clientId", "resourceId"\)/));
  for (const table of ["oauthRefreshToken", "oauthAccessToken"]) {
    const defs = await definitions(table);
    expect(defs, table).toContainEqual(expect.stringMatching(/UNIQUE INDEX .* \(token\)/));
    expect(defs, table).toContainEqual(expect.stringMatching(/ \("userId", "clientId"\)/));
  }
  expect(await definitions("oauthConsent")).toContainEqual(expect.stringMatching(/ \("userId", "clientId"\)/));
});

test("the dispatch queue index exists, is valid and is partial like its precedent", async () => {
  const rows = await indexesOf("Order");
  const queue = rows.find((row) => row.indexname === "Order_dispatch_queue_idx");
  expect(queue?.valid).toBe(true);
  expect(queue?.indexdef).toContain('("companyId", "scheduledDispatchDate", number)');
  expect(queue?.indexdef).toMatch(/WHERE \(NOT cancelled\) AND \("deliveryStatus" = 'pending'::text\)|WHERE \(\(NOT cancelled\) AND/);
  expect(rows.find((row) => row.indexname === "Order_undeducted_pending_idx")?.valid).toBe(true);
});

test("AssistantConnection forces row level security with its company policy", async () => {
  const [table] = await systemPrisma.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'AssistantConnection'`;
  expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const policies = await systemPrisma.$queryRaw<{ policyname: string }[]>`SELECT policyname FROM pg_policies WHERE tablename = 'AssistantConnection'`;
  expect(policies).toEqual([{ policyname: "assistant_connection_company_isolation" }]);
});
