import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

afterAll(() => systemPrisma.$disconnect());

const newTables = ["OrderItemChange", "OrderReview", "OrderLinkAction", "MessageTrace", "MessageMaskedText", "MessageTraceRead"];

async function fixture() {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const [orderId, messageId, changeId] = [randomUUID(), randomUUID(), randomUUID()];
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Changes", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    const chat = await prisma.chat.create({ data: { contactId: contact.id } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: chat.id, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "hola", uploadedByUserId: sellerId, sentAt: new Date(), receivedAt: new Date() } });
    await prisma.order.create({ data: { id: orderId, number: BigInt(Math.floor(Math.random() * 1e9) + 1001), sellerId, chatId: chat.id, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date() } });
    await prisma.orderItemChange.create({ data: { id: changeId, orderId, messageId, position: 0, seq: 1, kind: "added", decision: "applied", after: { itemId: randomUUID() } } });
  });
  return { companyId, orderId, messageId, changeId, async cleanup() {
    await withTenantIsolation(companyId, async () => {
      await prisma.orderItemChange.deleteMany();
      await prisma.order.deleteMany();
      await prisma.chatMessage.deleteMany();
      await prisma.chat.deleteMany();
      await prisma.contact.deleteMany();
      await systemPrisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  } };
}

test("change rows of one company are invisible to another company", async () => {
  const [x, y] = [await fixture(), await fixture()];
  try {
    await withTenantIsolation(x.companyId, async () => {
      expect((await prisma.orderItemChange.findMany()).map((row) => row.id)).toEqual([x.changeId]);
    });
    await withTenantIsolation(y.companyId, async () => {
      expect((await prisma.orderItemChange.findMany()).map((row) => row.id)).toEqual([y.changeId]);
      expect(await prisma.orderItemChange.findUnique({ where: { id: x.changeId } })).toBeNull();
      expect((await prisma.orderItemChange.updateMany({ where: { id: x.changeId }, data: { verdict: "kept", verdictAt: new Date() } })).count).toBe(0);
      // The order and message belong to the other company, so a row cannot be written for them even with their ids.
      await expect(prisma.orderItemChange.create({ data: { orderId: x.orderId, messageId: x.messageId, position: 1, seq: 2, kind: "removed", decision: "applied", before: { itemId: randomUUID() } } })).rejects.toThrow();
    });
  } finally { await x.cleanup(); await y.cleanup(); }
});

test("the change checks reject a row without a line, a doubt that does not match its decision and a verdict without its date", async () => {
  const f = await fixture();
  try {
    await withTenantIsolation(f.companyId, async () => {
      const base = { orderId: f.orderId, messageId: f.messageId, kind: "added" as const, decision: "applied" as const, after: { itemId: randomUUID() } };
      await expect(prisma.orderItemChange.create({ data: { ...base, position: 1, seq: 2, after: undefined } })).rejects.toThrow();
      await expect(prisma.orderItemChange.create({ data: { ...base, position: 2, seq: 3, decision: "doubtful" } })).rejects.toThrow();
      await expect(prisma.orderItemChange.create({ data: { ...base, position: 3, seq: 4, doubt: { kind: "caption_unread" } } })).rejects.toThrow();
      await expect(prisma.orderItemChange.create({ data: { ...base, position: 4, seq: 5, verdict: "kept" } })).rejects.toThrow();
      await expect(prisma.orderItemChange.create({ data: { ...base, position: 0, seq: 6 } })).rejects.toThrow();
      await expect(prisma.orderItemChange.create({ data: { ...base, position: 5, seq: 1 } })).rejects.toThrow();
      await prisma.orderItemChange.create({ data: { ...base, position: 6, seq: 7, decision: "doubtful", doubt: { kind: "caption_unread" }, verdict: "kept", verdictAt: new Date() } });
    });
  } finally { await f.cleanup(); }
});

test("every new table forces row level security with its company policy", async () => {
  const tables = await systemPrisma.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(${newTables}) AND relkind = 'r' ORDER BY relname`;
  expect(tables).toEqual([...newTables].sort().map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })));
  const policies = await systemPrisma.$queryRaw<{ tablename: string; policyname: string }[]>`
    SELECT tablename, policyname FROM pg_policies WHERE tablename = ANY(${newTables}) ORDER BY tablename`;
  expect(policies.map((policy) => policy.tablename)).toEqual([...newTables].sort());
  for (const policy of policies) expect(policy.policyname).toMatch(/_company_isolation$/);
});

test("the new tables default their company to the transaction's and keep composite foreign keys with it", async () => {
  const columns = await systemPrisma.$queryRaw<{ table_name: string; column_default: string | null }[]>`
    SELECT table_name, column_default FROM information_schema.columns WHERE column_name = 'companyId' AND table_name = ANY(${newTables})`;
  expect(columns).toHaveLength(newTables.length);
  for (const column of columns) expect(column.column_default, column.table_name).toContain("app.company_id");
  const keys = await systemPrisma.$queryRaw<{ conname: string; definition: string }[]>`
    SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE contype = 'f' AND conrelid::regclass::text = ANY(${newTables.map((table) => `"${table}"`)}) AND pg_get_constraintdef(oid) NOT LIKE '%REFERENCES "Company"%'`;
  expect(keys.length).toBeGreaterThanOrEqual(8);
  for (const key of keys) expect(key.definition, key.conname).toMatch(/^FOREIGN KEY \("companyId", /);
});

test("the expired and verdict functions are not executable by PUBLIC and are executable by the application role", async () => {
  const functions = await systemPrisma.$queryRaw<{ proname: string; public_can: boolean; app_can: boolean; definer: boolean }[]>`
    SELECT p.proname,
      EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_can,
      has_function_privilege('core_app', p.oid, 'EXECUTE') AS app_can, p.prosecdef AS definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('companies_with_expired_message_traces', 'message_change_verdict_counts') ORDER BY p.proname`;
  expect(functions).toEqual([
    { proname: "companies_with_expired_message_traces", public_can: false, app_can: true, definer: true },
    { proname: "message_change_verdict_counts", public_can: false, app_can: true, definer: true },
  ]);
});

test("the expired lookup lists the companies with an expired trace or masked text, and the verdict counts hold no ids or text", async () => {
  const f = await fixture();
  try {
    const past = new Date(Date.now() - 1000);
    await withTenantIsolation(f.companyId, async () => {
      await prisma.messageMaskedText.create({ data: { messageId: f.messageId, text: "hola", expiresAt: past } });
      const expired = await prisma.$queryRaw<{ companies_with_expired_message_traces: string }[]>`SELECT * FROM companies_with_expired_message_traces(now())`;
      expect(expired.map((row) => row.companies_with_expired_message_traces)).toContain(f.companyId);
      const none = await prisma.$queryRaw<unknown[]>`SELECT * FROM companies_with_expired_message_traces(${new Date(Date.now() - 3_600_000)})`;
      expect(none.filter((row) => (row as Record<string, string>).companies_with_expired_message_traces === f.companyId)).toEqual([]);
      const counts = await prisma.$queryRaw<{ decision: string; doubt_kind: string | null; verdict: string | null; count: bigint }[]>`
        SELECT * FROM message_change_verdict_counts(${new Date(Date.now() - 3_600_000)}, ${new Date(Date.now() + 3_600_000)})`;
      expect(Object.keys(counts[0]!).sort()).toEqual(["count", "decision", "doubt_kind", "verdict"]);
      expect(counts).toContainEqual({ decision: "applied", doubt_kind: null, verdict: null, count: expect.any(BigInt) });
      await prisma.messageMaskedText.deleteMany();
    });
  } finally { await f.cleanup(); }
});

test("the replaced order indexes are gone, the new ones are valid and the partial ones are partial", async () => {
  const rows = await systemPrisma.$queryRaw<{ indexname: string; indexdef: string; valid: boolean }[]>`
    SELECT i.relname AS indexname, pg_get_indexdef(x.indexrelid) AS indexdef, x.indisvalid AS valid
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname IN ('Order', 'OrderMessage', 'OrderItemChange')`;
  const names = rows.map((row) => row.indexname);
  expect(names).not.toContain("Order_companyId_chatId_idx");
  expect(names).not.toContain("OrderMessage_companyId_orderId_idx");
  expect(rows.every((row) => row.valid)).toBe(true);
  expect(rows.find((row) => row.indexname === "Order_companyId_chatId_createdAt_idx")?.indexdef).toContain('("companyId", "chatId", "createdAt" DESC)');
  expect(rows.find((row) => row.indexname === "OrderMessage_companyId_orderId_createdAt_idx")?.indexdef).toContain('("companyId", "orderId", "createdAt")');
  expect(rows.find((row) => row.indexname === "OrderMessage_link_change_notice_idx")?.indexdef).toContain('WHERE "linkChangeNotice"');
  expect(rows.find((row) => row.indexname === "OrderItemChange_open_idx")?.indexdef).toMatch(/WHERE \(\(verdict IS NULL\) AND \("supersededById" IS NULL\)\)/);
  expect(names).toContain("OrderItemChange_companyId_orderId_seq_key");
  expect(names).toContain("OrderItemChange_companyId_messageId_orderId_position_key");
});
