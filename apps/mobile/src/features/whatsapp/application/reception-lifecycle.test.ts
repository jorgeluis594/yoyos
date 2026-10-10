import { err, ok } from "@shared/functional";
import { createReceptionLifecycle } from "@mobile/features/whatsapp/application/reception-lifecycle";
import type { LinkStore, Session } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, LinkId, UserId } from "@mobile/features/whatsapp/domain/ids";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { WhatsAppErrorCode, WhatsAppEvents } from "@mobile/modules/whatsapp/types";

const session: Session = { companyId: "c1" as CompanyId, userId: "u1" as UserId, generation: 1 };
const link = (companyId: string): WhatsAppLink => ({ id: "l1" as LinkId, companyId: companyId as CompanyId, linkedByUserId: "u1" as UserId, accountId: null, startedAt: new Date(0), endedAt: null });

function setup(options: { active?: WhatsAppLink | null; session?: Session | null; connectFails?: boolean } = {}) {
  const calls: string[] = [];
  const listeners: Record<string, ((payload: never) => void)[]> = {};
  let removed = 0;
  const whatsapp = {
    addListener: ((name: string, listener: (payload: never) => void) => {
      calls.push(`listen:${name}`);
      (listeners[name] ??= []).push(listener);
      return { remove: () => { removed += 1; listeners[name] = (listeners[name] ?? []).filter((l) => l !== listener); } };
    }) as never,
    initialize: async () => { calls.push("initialize"); return ok(undefined); },
    connect: async () => { calls.push("connect"); return options.connectFails ? err({ code: "CONNECTION_FAILED" as const, message: "x" }) : ok(undefined); },
    disconnect: async () => { calls.push("disconnect"); return ok(undefined); },
  };
  const links = { active: async () => ok("active" in options ? options.active ?? null : link("c1")) } as unknown as LinkStore;
  const sync = { wake: jest.fn(() => { calls.push("wake"); }), stop: jest.fn(() => { calls.push("stop-sync"); }) };
  const receive = jest.fn(async (_event: WhatsAppEvents["messageReceived"]) => ok({ status: "stored" as const }));
  const lifecycle = createReceptionLifecycle({ whatsapp, links, session: () => "session" in options ? options.session ?? null : session, receive, sync });
  const emit = (name: string, payload: unknown) => (listeners[name] ?? []).forEach((l) => l(payload as never));
  return { lifecycle, calls, emit, receive, sync, listenerCount: (name: string) => (listeners[name] ?? []).length, removed: () => removed };
}

test("registers the message consumer before initialize and connect", async () => {
  const { lifecycle, calls } = setup();
  expect(await lifecycle.start()).toMatchObject({ success: true });
  expect(calls.indexOf("listen:messageReceived")).toBeLessThan(calls.indexOf("initialize"));
  expect(calls.indexOf("initialize")).toBeLessThan(calls.indexOf("connect"));
});

test("does not connect without an active link", async () => {
  const { lifecycle, calls } = setup({ active: null });
  expect(await lifecycle.start()).toMatchObject({ success: false, error: { code: "NO_ACTIVE_LINK" } });
  expect(calls).toEqual([]);
});

test("does not connect when the active link belongs to another company", async () => {
  const { lifecycle, calls } = setup({ active: link("c2") });
  expect(await lifecycle.start()).toMatchObject({ success: false, error: { code: "LINK_OF_OTHER_COMPANY" } });
  expect(calls).toEqual([]);
});

test("does not connect without a Yoyos session", async () => {
  const { lifecycle, calls } = setup({ session: null });
  expect(await lifecycle.start()).toMatchObject({ success: false, error: { code: "NO_SESSION" } });
  expect(calls).toEqual([]);
});

test("registers the message consumer only once per runtime across restarts", async () => {
  const { lifecycle, listenerCount } = setup();
  await lifecycle.start();
  await lifecycle.start();
  expect(listenerCount("messageReceived")).toBe(1);
});

test("removes the consumer when connecting fails so it can be retried", async () => {
  const { lifecycle, listenerCount } = setup({ connectFails: true });
  expect(await lifecycle.start()).toMatchObject({ success: false, error: { code: "CONNECTION_FAILED" } });
  expect(listenerCount("messageReceived")).toBe(0);
});

test("delivers received messages to the receive use case", async () => {
  const { lifecycle, emit, receive } = setup();
  await lifecycle.start();
  const event = { deliveryId: "d", message: {} };
  emit("messageReceived", event);
  expect(receive).toHaveBeenCalledWith(event);
});

test("publishes connectionChanged and error events as status", async () => {
  const { lifecycle, emit } = setup();
  const seen: unknown[] = [];
  lifecycle.subscribe((status) => seen.push(status));
  await lifecycle.start();
  emit("connectionChanged", { state: "connected" });
  emit("error", { code: "CONNECTION_FAILED", message: "boom" });
  expect(lifecycle.status()).toEqual({ connection: "connected", notice: null, lastError: { code: "CONNECTION_FAILED", message: "boom" } });
  expect(seen).toHaveLength(2);
});

test("keeps the connection for informational errors", async () => {
  const { lifecycle, emit } = setup();
  await lifecycle.start();
  emit("connectionChanged", { state: "connected" });
  for (const code of ["RECOVERY_BUFFER_FULL", "HISTORY_LIMIT_REACHED", "IDENTITY_UNAVAILABLE"] as WhatsAppErrorCode[]) {
    emit("error", { code, message: "m" });
    expect(lifecycle.status()).toMatchObject({ connection: "connected", notice: code, lastError: null });
  }
});

test("publishes a local storage failure while receiving as the last error", async () => {
  const { lifecycle, emit, receive } = setup();
  receive.mockResolvedValueOnce(err({ code: "LOCAL_STORAGE_FAILED", message: "Local storage failed" }) as never);
  await lifecycle.start();
  emit("messageReceived", {});
  await Promise.resolve();
  await Promise.resolve();
  expect(lifecycle.status().lastError).toEqual({ code: "LOCAL_STORAGE_FAILED", message: "Local storage failed" });
});

test("sign-out stops sync, removes the consumer and disconnects without logout or local deletion", async () => {
  const { lifecycle, calls, listenerCount } = setup();
  await lifecycle.start();
  expect(await lifecycle.signedOut()).toEqual({ success: true, data: undefined });
  expect(listenerCount("messageReceived")).toBe(0);
  expect(calls).toContain("stop-sync");
  expect(calls[calls.length - 1]).toBe("disconnect");
  expect(calls).not.toContain("logout");
});

test("sign-in with the company of the active link starts reception and wakes sync", async () => {
  const { lifecycle, calls, sync } = setup();
  expect(await lifecycle.signedIn()).toMatchObject({ success: true });
  expect(calls).toContain("connect");
  expect(sync.wake).toHaveBeenCalledTimes(1);
});

test("sign-in with another company does not connect", async () => {
  const { lifecycle, calls, sync } = setup({ active: link("c2") });
  expect(await lifecycle.signedIn()).toMatchObject({ success: false, error: { code: "LINK_OF_OTHER_COMPANY" } });
  expect(calls).not.toContain("connect");
  expect(sync.wake).not.toHaveBeenCalled();
});
