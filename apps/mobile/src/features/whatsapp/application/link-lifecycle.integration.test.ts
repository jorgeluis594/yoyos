import { ok } from "@shared/functional";
import { createWhatsAppRuntime } from "@mobile/features/whatsapp/composition";
import type { WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, UserId } from "@mobile/features/whatsapp/domain/ids";
import { migrateWhatsAppDatabase } from "@mobile/features/whatsapp/infrastructure/local-database";
import { openTestDatabase } from "@mobile/features/whatsapp/infrastructure/node-sqlite-database";

type Handler = (payload: unknown) => void;

async function setup() {
  const database = openTestDatabase();
  await migrateWhatsAppDatabase(database);
  const calls: string[] = [];
  const listeners = new Map<string, Set<Handler>>();
  const gateway = {
    initialize: async () => { calls.push("initialize"); return ok(undefined); },
    connect: async () => { calls.push("connect"); return ok(undefined); },
    disconnect: async () => { calls.push("disconnect"); return ok(undefined); },
    logout: async () => { calls.push("logout"); return ok(undefined); },
    confirmMessageStored: async () => ok(undefined),
    downloadImage: async () => ok({ uri: "file:///x", mimeType: "image/png", size: 1 }), deleteDownloadedImage: async () => ok(undefined),
    addListener: (name: string, listener: Handler) => {
      const set = listeners.get(name) ?? new Set<Handler>();
      set.add(listener);
      listeners.set(name, set);
      return { remove: () => { set.delete(listener); } };
    },
  } as unknown as WhatsAppGateway;
  let ids = 0;
  const runtime = createWhatsAppRuntime({
    database, gateway, generation: () => 1, newId: () => `link-${++ids}`, now: () => new Date(5000), random: () => 0.5, schedule: () => () => undefined,
    request: async () => ok({}),
  });
  runtime.setIdentity({ companyId: "c1", userId: "u1" });
  const emit = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
  const count = (name: string) => calls.filter((call) => call === name).length;
  return { database, runtime, calls, emit, count, listenerCount: (name: string) => listeners.get(name)?.size ?? 0 };
}

test("linking again after unlinking initializes, connects and shows a fresh QR", async () => {
  const ctx = await setup();
  expect(await ctx.runtime.linkAccount()).toMatchObject({ success: true });
  ctx.emit("qr", { value: "qr-1", expiresAt: 100 });
  expect(ctx.runtime.reception.status().qr).toEqual({ value: "qr-1", expiresAt: 100 });

  expect(await ctx.runtime.unlinkAccount()).toEqual({ success: true, data: { remoteLogoutConfirmed: true } });
  expect(ctx.calls).toEqual(["initialize", "connect", "initialize", "logout"]);
  expect(await ctx.runtime.links.active()).toEqual({ success: true, data: null });
  expect(ctx.listenerCount("messageReceived")).toBe(0);
  expect(ctx.runtime.reception.status().qr).toBeNull();

  expect(await ctx.runtime.linkAccount()).toMatchObject({ success: true });
  expect(ctx.count("initialize")).toBe(3);
  expect(ctx.count("connect")).toBe(2);
  ctx.emit("qr", { value: "qr-2", expiresAt: 200 });
  expect(ctx.runtime.reception.status().qr).toEqual({ value: "qr-2", expiresAt: 200 });
  expect(ctx.listenerCount("messageReceived")).toBe(1);
  ctx.database.close();
});

test("unlinking a link of another company ends it without ever starting reception", async () => {
  const ctx = await setup();
  const other = await ctx.runtime.links.start("c2" as CompanyId, "u2" as UserId, new Date(0));
  expect(other.success).toBe(true);

  expect(await ctx.runtime.unlinkAccount()).toMatchObject({ success: true });
  expect(ctx.calls).toEqual(["initialize", "logout"]);
  expect(await ctx.runtime.links.active()).toEqual({ success: true, data: null });
  expect(await ctx.runtime.links.all()).toMatchObject({ success: true, data: [{ companyId: "c2", endedAt: expect.any(Date) }] });

  expect(await ctx.runtime.linkAccount()).toMatchObject({ success: true });
  expect(ctx.count("connect")).toBe(1);
  ctx.database.close();
});
