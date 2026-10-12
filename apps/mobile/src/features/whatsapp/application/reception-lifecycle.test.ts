import { err, ok } from "@shared/functional";
import { createReceptionLifecycle } from "@mobile/features/whatsapp/application/reception-lifecycle";
import type { LinkStore, Session } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, LinkId, UserId } from "@mobile/features/whatsapp/domain/ids";
import type { WhatsAppLink } from "@mobile/features/whatsapp/domain/link";
import type { WhatsAppErrorCode, WhatsAppEvents } from "@mobile/modules/whatsapp/types";

const session: Session = { companyId: "c1" as CompanyId, userId: "u1" as UserId, generation: 1 };
const link = (companyId: string): WhatsAppLink => ({ id: "l1" as LinkId, companyId: companyId as CompanyId, linkedByUserId: "u1" as UserId, accountId: null, startedAt: new Date(0), endedAt: null });

function setup(options: { active?: WhatsAppLink | null; session?: Session | null; connectFails?: boolean; activeGate?: Promise<void> } = {}) {
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
    logout: async () => { calls.push("logout"); return ok(undefined); },
  };
  const activeLink = "active" in options ? options.active ?? null : link("c1");
  const links = { active: async () => { await options.activeGate; return ok(activeLink); } } as unknown as LinkStore;
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
  expect(lifecycle.status()).toEqual({ connection: "connected", qr: null, notice: null, lastError: { code: "CONNECTION_FAILED", message: "boom" } });
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
  emit("messageReceived", { deliveryId: "d", message: { direction: "incoming", text: "x" } });
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

test("publishes the QR until the connection is established", async () => {
  const { lifecycle, emit } = setup();
  await lifecycle.start();
  emit("qr", { value: "qr-1", expiresAt: 123 });
  expect(lifecycle.status().qr).toEqual({ value: "qr-1", expiresAt: 123 });
  emit("connectionChanged", { state: "connected" });
  expect(lifecycle.status()).toMatchObject({ connection: "connected", qr: null });
});

test("concurrent starts share one attempt and register listeners once", async () => {
  const { lifecycle, calls, listenerCount } = setup();
  const [first, second] = await Promise.all([lifecycle.start(), lifecycle.start()]);
  expect(first).toMatchObject({ success: true });
  expect(second).toMatchObject({ success: true });
  for (const name of ["messageReceived", "qr", "connectionChanged", "error"]) expect(listenerCount(name)).toBe(1);
  expect(calls.filter((call) => call === "initialize")).toHaveLength(1);
  expect(calls.filter((call) => call === "connect")).toHaveLength(1);
});

test("sign-out while start waits for the active link cancels it", async () => {
  let open = () => undefined as void;
  const activeGate = new Promise<void>((resolve) => { open = resolve; });
  const { lifecycle, calls, listenerCount } = setup({ activeGate });
  const starting = lifecycle.start();
  await lifecycle.signedOut();
  open();
  expect(await starting).toMatchObject({ success: false, error: { code: "CANCELLED" } });
  expect(listenerCount("messageReceived")).toBe(0);
  expect(calls).not.toContain("connect");
  expect(calls).not.toContain("initialize");
});

test("logout after start stops reception, initializes and logs out", async () => {
  const { lifecycle, calls, listenerCount, sync } = setup();
  await lifecycle.start();
  calls.length = 0;
  expect(await lifecycle.logout()).toEqual({ success: true, data: undefined });
  expect(listenerCount("messageReceived")).toBe(0);
  expect(calls).toEqual(["initialize", "logout"]);
  expect(sync.stop).not.toHaveBeenCalled();
});

test("logout without a previous start initializes before logging out", async () => {
  const { lifecycle, calls } = setup({ active: link("c2") });
  expect(await lifecycle.start()).toMatchObject({ success: false, error: { code: "LINK_OF_OTHER_COMPANY" } });
  expect(await lifecycle.logout()).toEqual({ success: true, data: undefined });
  expect(calls).toEqual(["initialize", "logout"]);
});

test("start after logout initializes and connects again", async () => {
  const { lifecycle, calls } = setup();
  await lifecycle.start();
  await lifecycle.logout();
  calls.length = 0;
  expect(await lifecycle.start()).toMatchObject({ success: true });
  expect(calls.filter((call) => call === "initialize" || call === "connect")).toEqual(["initialize", "connect"]);
});

test("clears the last error when the connection is established again", async () => {
  const { lifecycle, emit } = setup();
  await lifecycle.start();
  emit("error", { code: "CONNECTION_FAILED", message: "boom" });
  expect(lifecycle.status().lastError).not.toBeNull();
  emit("connectionChanged", { state: "connected" });
  expect(lifecycle.status().lastError).toBeNull();
});

test("clears the last error after a message is received successfully", async () => {
  const { lifecycle, emit, receive } = setup();
  receive.mockResolvedValueOnce(err({ code: "LOCAL_STORAGE_FAILED", message: "x" }) as never);
  await lifecycle.start();
  emit("messageReceived", { deliveryId: "d", message: { direction: "incoming" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(lifecycle.status().lastError).not.toBeNull();
  emit("messageReceived", { deliveryId: "d2", message: { direction: "incoming" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(lifecycle.status().lastError).toBeNull();
});

test("a start right after stop runs its own attempt while the cancelled one gives up", async () => {
  let open = () => undefined as void;
  const activeGate = new Promise<void>((resolve) => { open = resolve; });
  const { lifecycle, calls, listenerCount } = setup({ activeGate });
  const first = lifecycle.start();
  lifecycle.stop();
  const second = lifecycle.start();
  open();
  expect(await first).toMatchObject({ success: false, error: { code: "CANCELLED" } });
  expect(await second).toMatchObject({ success: true });
  expect(calls.filter((call) => call === "initialize" || call === "connect")).toEqual(["initialize", "connect"]);
  for (const name of ["messageReceived", "qr", "connectionChanged", "error"]) expect(listenerCount(name)).toBe(1);
});
