import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { createEventBusRuntime } from "@core/src/composition/event-bus";
import { registerMobileMessage } from "@core/src/features/chats/register-mobile-message";
import { markEventDispatched } from "@core/src/features/chats/infrastructure/mobile-message-dispatch";
import { parseMobileMessage } from "@core/src/features/chats/presentation/mobile-message-schemas";
import type { RegistrationContext } from "@core/src/features/chats/domain/mobile-message";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

type Runtime = ReturnType<typeof createEventBusRuntime>;
const events = globalThis as typeof globalThis & { __yoyosEvents?: Runtime };
const nativeId = (protocol: string) => `wa-message:v1:${Buffer.from(JSON.stringify(["123@lid", "456@lid", protocol])).toString("base64url")}`;

async function fixture() {
  const companyId = randomUUID() as RegistrationContext["companyId"];
  await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Mobile dispatch", country: "PE" } }));
  return { companyId, context: { companyId, uploadedByUserId: "test-user" }, cleanup: () => withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
    await prisma.chat.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  }) };
}

function input(protocol: string) {
  const parsed = parseMobileMessage({ version: 1, message: { id: nativeId(protocol), accountId: "123@lid", chatId: "456@lid", whatsappMessageId: protocol,
    direction: "incoming", timestamp: 1791417600123, content: { type: "text", text: "private text" } } });
  expect(parsed).not.toBeNull();
  return parsed!;
}

test("marker is tenant scoped, idempotent and preserves its first timestamp", async () => {
  const a = await fixture();
  const b = await fixture();
  const runtime = createEventBusRuntime();
  events.__yoyosEvents = runtime;
  try {
    await runtime.provider.start();
    const saved = await registerMobileMessage(input("marker"), a.context);
    expect(saved).toMatchObject({ success: true, data: { status: "stored" } });
    if (!saved.success) return;
    const first = await withTenantIsolation(a.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { id: saved.data.messageId }, select: { eventDispatchedAt: true } }));
    expect(first.eventDispatchedAt).toBeInstanceOf(Date);
    expect(await markEventDispatched(a.companyId, saved.data.messageId, new Date("2030-01-01"))).toEqual({ success: true, data: undefined });
    const second = await withTenantIsolation(a.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { id: saved.data.messageId }, select: { eventDispatchedAt: true } }));
    expect(second.eventDispatchedAt).toEqual(first.eventDispatchedAt);
    expect(await markEventDispatched(b.companyId, saved.data.messageId, new Date())).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    expect(await markEventDispatched(a.companyId, randomUUID() as typeof saved.data.messageId, new Date())).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  } finally { await runtime.provider.stop(); delete events.__yoyosEvents; await a.cleanup(); await b.cleanup(); }
});

test("real provider recovers pending dispatch after restart and concurrent registration shares one event identity", async () => {
  const f = await fixture();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let runtime = createEventBusRuntime();
  events.__yoyosEvents = runtime;
  try {
    const pending = await registerMobileMessage(input("recover"), f.context);
    expect(pending).toMatchObject({ success: false, error: { code: "EVENT_BUS_UNAVAILABLE" } });
    const row = await withTenantIsolation(f.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { companyId: f.companyId, whatsappMessageId: "recover" } }));
    expect(row.eventDispatchedAt).toBeNull();
    await runtime.provider.stop();
    runtime = createEventBusRuntime();
    events.__yoyosEvents = runtime;
    await runtime.provider.start();
    const retried = await registerMobileMessage({ ...input("recover"), content: { type: "text", text: "changed" } }, f.context);
    expect(retried).toMatchObject({ success: true, data: { status: "duplicate", messageId: row.id, eventId: row.id, receivedAt: row.receivedAt } });
    const publish = runtime.provider.publish.bind(runtime.provider);
    const observed = vi.spyOn(runtime.provider, "publish").mockImplementation(async (name, payload, metadata) => {
      const committed = await withTenantIsolation(payload.companyId, async () => await prisma.chatMessage.findFirst({ where: { id: metadata.eventId } }));
      expect(committed?.id).toBe(metadata.eventId);
      return publish(name, payload, metadata);
    });
    const race = await Promise.all(Array.from({ length: 10 }, () => registerMobileMessage(input("race"), f.context)));
    expect(race.every(result => result.success)).toBe(true);
    expect(race.filter(result => result.success && result.data.status === "stored")).toHaveLength(1);
    expect(new Set(race.map(result => result.success && result.data.eventId)).size).toBe(1);
    expect(observed).toHaveBeenCalled();
    const rows = await withTenantIsolation(f.companyId, async () => await prisma.chatMessage.findMany({ where: { companyId: f.companyId } }));
    expect(rows).toHaveLength(2);
    expect(rows.every(result => result.eventDispatchedAt !== null)).toBe(true);
    expect((await pool.query("SELECT id FROM pgboss.job WHERE data->>'name' = 'whatsapp_message_recorded'")).rowCount).toBe(0);
    await runtime.provider.stop();
    const stopped = await registerMobileMessage(input("stopped"), f.context);
    expect(stopped).toMatchObject({ success: false, error: { code: "EVENT_BUS_UNAVAILABLE" } });
    runtime = createEventBusRuntime();
    events.__yoyosEvents = runtime;
    await runtime.provider.start();
    const recovered = await registerMobileMessage(input("stopped"), f.context);
    expect(recovered).toMatchObject({ success: true, data: { status: "duplicate" } });
    const stoppedRow = await withTenantIsolation(f.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { companyId: f.companyId, whatsappMessageId: "stopped" } }));
    expect(stoppedRow.eventDispatchedAt).toBeInstanceOf(Date);
    expect(recovered.success && recovered.data.eventId).toBe(stoppedRow.id);
  } finally { await runtime.provider.stop(); delete events.__yoyosEvents; await pool.end(); await f.cleanup(); }
});

test("failed marker keeps committed row pending and retry republishes its stable event", async () => {
  const f = await fixture();
  const runtime = createEventBusRuntime();
  events.__yoyosEvents = runtime;
  const admin = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  const trigger = `mobile_marker_${randomUUID().replaceAll("-", "")}`;
  await admin.connect();
  try {
    const pending = await registerMobileMessage(input("mark-failure"), f.context);
    expect(pending).toMatchObject({ success: false, error: { code: "EVENT_BUS_UNAVAILABLE" } });
    const row = await withTenantIsolation(f.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { companyId: f.companyId, whatsappMessageId: "mark-failure" } }));
    await runtime.provider.start();
    await admin.query(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected marker failure' USING ERRCODE = '23514'; END $$;
      CREATE TRIGGER "${trigger}" BEFORE UPDATE OF "eventDispatchedAt" ON "ChatMessage"
      FOR EACH ROW WHEN (NEW."id" = '${row.id}'::uuid) EXECUTE FUNCTION "${trigger}"()`);
    expect(await registerMobileMessage(input("mark-failure"), f.context)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    const unchanged = await withTenantIsolation(f.companyId, async () => await prisma.chatMessage.findFirstOrThrow({ where: { id: row.id } }));
    expect(unchanged.eventDispatchedAt).toBeNull();
    await admin.query(`DROP TRIGGER "${trigger}" ON "ChatMessage"; DROP FUNCTION "${trigger}"()`);
    expect(await registerMobileMessage(input("mark-failure"), f.context)).toMatchObject({ success: true, data: {
      status: "duplicate", messageId: row.id, eventId: row.id, receivedAt: row.receivedAt,
    } });
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS "${trigger}" ON "ChatMessage"; DROP FUNCTION IF EXISTS "${trigger}"()`);
    await admin.end();
    await runtime.provider.stop();
    delete events.__yoyosEvents;
    await f.cleanup();
  }
});
