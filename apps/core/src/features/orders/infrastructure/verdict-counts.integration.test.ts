import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { countVerdicts } from "@core/src/features/orders/infrastructure/verdict-counts";
import { reportConfiguredVerdictLabels } from "@core/src/features/orders/composition";
import { hashToken, parseTraceReaders } from "@core/src/features/orders/presentation/trace-reader-token";
import { runVerdictsReport } from "@core/src/features/orders/presentation/verdicts-command";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

afterAll(() => systemPrisma.$disconnect());

type Seed = { decision: "applied" | "doubtful"; doubt?: { kind: string }; verdict: "kept" | "quantity_changed" | "removed" | "undone" | "not_reviewed" | null };
// A window no other test writes to, so the shared database cannot change the counts.
const at = new Date("2041-03-10T12:00:00Z");

async function company(seeds: readonly Seed[]) {
  const companyId = randomUUID();
  const sellerId = randomUUID();
  const messageId = randomUUID();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Verdicts", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Seller", email: `${sellerId}@example.test`, companyId } });
    const contact = await prisma.contact.create({ data: { whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    const chat = await prisma.chat.create({ data: { contactId: contact.id } });
    await prisma.chatMessage.create({ data: { id: messageId, chatId: chat.id, externalId: `ext-${messageId}`, whatsappMessageId: `wa-${messageId}`, direction: "incoming",
      source: "contact", type: "text", text: "quiero polos secretos", uploadedByUserId: sellerId, sentAt: new Date(), receivedAt: new Date() } });
    const orderId = randomUUID();
    await prisma.order.create({ data: { id: orderId, number: BigInt(Math.floor(Math.random() * 1e9) + 1001), sellerId, chatId: chat.id, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date() } });
    await prisma.orderItemChange.createMany({ data: seeds.map((seed, index) => ({ id: randomUUID(), orderId, messageId, position: index, seq: index + 1, kind: "added" as const,
      decision: seed.decision, doubt: seed.doubt ?? undefined, verdict: seed.verdict, verdictAt: seed.verdict ? at : null, createdAt: at, after: { itemId: randomUUID() } })) });
  });
  return { companyId, async cleanup() {
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

test("the verdicts report returns counts by decision, doubt kind and verdict without ids or text", async () => {
  const [a, b] = [
    await company([
      { decision: "doubtful", doubt: { kind: "variant_changed" }, verdict: "kept" },
      { decision: "doubtful", doubt: { kind: "variant_changed" }, verdict: "kept" },
      { decision: "applied", verdict: "kept" },
      { decision: "applied", verdict: "removed" },
    ]),
    await company([
      { decision: "doubtful", doubt: { kind: "variant_changed" }, verdict: "kept" },
      { decision: "doubtful", doubt: { kind: "removed" }, verdict: "undone" },
      { decision: "doubtful", doubt: { kind: "removed" }, verdict: "not_reviewed" },
      { decision: "applied", verdict: null },
    ]),
  ];
  try {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runVerdictsReport({ args: ["--since", "2041-03-01", "--until", "2041-04-01"], readers: parseTraceReaders(`Ana:${hashToken("ana-token")}`), osUser: "jorge", token: async () => "ana-token",
      report: reportConfiguredVerdictLabels, print: (text) => out.push(text), fail: (text) => errors.push(text) });
    expect(errors).toEqual([]);
    expect(code).toBe(0);
    const printed = out.join("");
    const byKey = (row: { decision: string; doubtKind: string | null; verdict: string }) => `${row.decision}/${row.doubtKind}/${row.verdict}`;
    const report = JSON.parse(printed) as { rows: { decision: string; doubtKind: string | null; verdict: string; count: number; strength: string | null }[]; unverdicted: number };
    expect(Object.fromEntries(report.rows.map((row) => [byKey(row), [row.count, row.strength]]))).toEqual({
      "doubtful/variant_changed/kept": [3, "strong"],
      "applied/null/kept": [1, "weak"],
      "applied/null/removed": [1, "strong"],
      "doubtful/removed/undone": [1, "strong"],
      "doubtful/removed/not_reviewed": [1, null],
    });
    expect(report.unverdicted).toBe(1);
    expect(printed).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(printed).not.toContain("secretos");
  } finally { await a.cleanup(); await b.cleanup(); }
}, 30_000);

test("the verdicts report refuses a window over 366 days or with since after until", async () => {
  const tooLong = await reportConfiguredVerdictLabels({ since: new Date("2040-01-01T00:00:00Z"), until: new Date("2041-06-01T00:00:00Z") });
  expect(tooLong).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  const inverted = await reportConfiguredVerdictLabels({ since: new Date("2041-04-01T00:00:00Z"), until: new Date("2041-03-01T00:00:00Z") });
  expect(inverted).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
});

test("the verdict scan runs under the configured statement timeout", async () => {
  let applied = "";
  const result = await countVerdicts(new Date("2041-03-01T00:00:00Z"), new Date("2041-04-01T00:00:00Z"), 7000, (setting) => { applied = setting; });
  expect(result.success).toBe(true);
  expect(applied).toBe("7s");
});

test("the aggregate itself refuses an invalid window", async () => {
  await expect(systemPrisma.$queryRaw`SELECT * FROM public.message_change_verdict_counts('2041-04-01'::timestamptz, '2041-03-01'::timestamptz)`).rejects.toThrow();
  await expect(systemPrisma.$queryRaw`SELECT * FROM public.message_change_verdict_counts('2039-01-01'::timestamptz, '2041-03-01'::timestamptz)`).rejects.toThrow();
});
