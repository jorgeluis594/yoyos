import { createWhatsAppClient } from "@mobile/modules/whatsapp/client";

function fakeNative() {
  const handlers = new Map<string, (value: unknown) => void>();
  return {
    handlers,
    addListener: jest.fn((event: string, callback: (value: unknown) => void) => {
      handlers.set(event, callback);
      return { remove() {} };
    }),
    initialize: jest.fn().mockResolvedValue({ success: true, data: { state: "disconnected" } }),
    connect: jest.fn().mockResolvedValue({ success: true }),
    disconnect: jest.fn().mockResolvedValue({ success: true }),
    logout: jest.fn().mockResolvedValue({ success: true }),
    confirmMessageStored: jest.fn().mockResolvedValue({ success: true }),
    downloadImage: jest.fn().mockResolvedValue({ success: false, error: { code: "IMAGE_UNAVAILABLE", message: "secret" } }),
    deleteDownloadedImage: jest.fn().mockResolvedValue({ success: true }),
  };
}

test("coalesces preparation, accepts connect before QR, and retries failed preparation", async () => {
  const native = fakeNative();
  let resolve!: (value: unknown) => void;
  native.initialize.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const client = createWhatsAppClient(() => native);
  const first = client.initialize();
  const second = client.initialize();
  expect(native.initialize).toHaveBeenCalledTimes(1);
  resolve({ success: false, error: { code: "SESSION_STORAGE_FAILED", message: "secret" } });
  await expect(first).resolves.toMatchObject({ success: false, error: { code: "SESSION_STORAGE_FAILED", message: "WhatsApp session storage failed" } });
  await second;
  expect(await client.initialize()).toEqual({ success: true, data: undefined });
  expect(native.initialize).toHaveBeenCalledTimes(2);
  expect(await client.connect()).toEqual({ success: true, data: undefined });
});

test("keeps local confirmation available for invalid session and validates inputs before mutation", async () => {
  const native = fakeNative();
  native.initialize.mockResolvedValueOnce({ success: false, error: { code: "SESSION_STATE_INVALID" } });
  const client = createWhatsAppClient(() => native);
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "NOT_INITIALIZED" } });
  expect(await client.initialize()).toMatchObject({ success: false, error: { code: "SESSION_STATE_INVALID" } });
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "SESSION_STATE_INVALID" } });
  const id = `wa-delivery:v1:${"a".repeat(32)}`;
  expect(await client.confirmMessageStored(id)).toEqual({ success: true, data: undefined });
  expect(await client.confirmMessageStored("bad")).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(native.confirmMessageStored).toHaveBeenCalledTimes(1);
});

test("validates native results and sanitizes diagnostics", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  native.connect.mockResolvedValueOnce({ success: true, data: "unexpected" }).mockRejectedValueOnce(new Error("secret"));
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE" } });
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "NATIVE_CALL_FAILED", message: "WhatsApp native call failed" } });
  expect(await client.downloadImage({ messageId: "wa-message:v1:YWJj", downloadReference: "wa-image:v1:YWJj" })).toMatchObject({ success: false, error: { code: "IMAGE_UNAVAILABLE", message: "WhatsApp image is unavailable" } });
});

test("replays only current state and unexpired QR to each new listener", async () => {
  const native = fakeNative();
  let now = 100;
  const client = createWhatsAppClient(() => native, () => now);
  const prior = jest.fn();
  client.addListener("connectionChanged", prior);
  await client.initialize();
  prior.mockClear();
  const next = jest.fn();
  client.addListener("connectionChanged", next);
  await Promise.resolve();
  expect(next).toHaveBeenCalledWith({ state: "disconnected" });
  expect(prior).not.toHaveBeenCalled();
  native.handlers.get("connectionChanged")?.({ state: "awaitingQr" });
  native.handlers.get("qr")?.({ value: "private-qr", expiresAt: 200 });
  const qr = jest.fn();
  const subscription = client.addListener("qr", qr);
  await Promise.resolve();
  expect(qr).toHaveBeenCalledWith({ value: "private-qr", expiresAt: 200 });
  subscription.remove();
  now = 200;
  const expired = jest.fn();
  client.addListener("qr", expired);
  await Promise.resolve();
  expect(expired).not.toHaveBeenCalled();
  native.handlers.get("connectionChanged")?.({ state: "connected" });
  expect(qr).toHaveBeenCalledTimes(1);
});

test("drops stale queued replay and rejects malformed events", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const status = jest.fn();
  client.addListener("connectionChanged", status);
  native.handlers.get("connectionChanged")?.({ state: "connected" });
  await Promise.resolve();
  expect(status).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenCalledWith({ state: "connected" });
  const error = jest.fn();
  client.addListener("error", error);
  native.handlers.get("messageReceived")?.({ deliveryId: "bad", message: {} });
  expect(error).toHaveBeenCalledWith({ code: "INVALID_NATIVE_RESPONSE", message: "Invalid WhatsApp native response" });
});

test("remote logout uncertainty still permits a new explicit link request", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  native.logout.mockResolvedValueOnce({ success: false, error: { code: "REMOTE_LOGOUT_UNCONFIRMED" } });
  expect(await client.logout()).toMatchObject({ success: false, error: { code: "REMOTE_LOGOUT_UNCONFIRMED" } });
  expect(await client.connect()).toEqual({ success: true, data: undefined });
});

test("initialization adopts a valid native QR without requesting another connection", async () => {
  const native = fakeNative();
  native.initialize.mockResolvedValueOnce({ success: true, data: { state: "awaitingQr", qr: { value: "active", expiresAt: 300 } } });
  const client = createWhatsAppClient(() => native, () => 100);
  await client.initialize();
  const qr = jest.fn();
  client.addListener("qr", qr);
  await Promise.resolve();
  expect(qr).toHaveBeenCalledWith({ value: "active", expiresAt: 300 });
  expect(native.connect).not.toHaveBeenCalled();
});
