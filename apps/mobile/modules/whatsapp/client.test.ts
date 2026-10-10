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
    setMessageConsumer: jest.fn().mockResolvedValue({ success: true }),
    removeMessageConsumer: jest.fn().mockResolvedValue({ success: true }),
    downloadImage: jest.fn().mockResolvedValue({ success: false, error: { code: "IMAGE_UNAVAILABLE", message: "secret" } }),
    deleteDownloadedImage: jest.fn().mockResolvedValue({ success: true }),
  };
}

test("reports unavailable module without simulating capability", async () => {
  const client = createWhatsAppClient(() => null);
  const subscription = client.addListener("connectionChanged", jest.fn());
  expect(await client.initialize()).toMatchObject({ success:false, error:{code:"MODULE_UNAVAILABLE"} });
  expect(await client.connect()).toMatchObject({ success:false, error:{code:"MODULE_UNAVAILABLE"} });
  expect(await client.disconnect()).toMatchObject({ success:false, error:{code:"MODULE_UNAVAILABLE"} });
  subscription.remove();
});

test("requires initialization for every available local operation", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  const id = `wa-delivery:v1:${"a".repeat(32)}`;
  const reference = {messageId:"wa-message:v1:YWJj",downloadReference:"wa-image:v1:YWJj"};
  for (const operation of [client.connect,client.disconnect,client.logout,()=>client.confirmMessageStored(id),()=>client.downloadImage(reference),()=>client.deleteDownloadedImage(reference.messageId)]) {
    expect(await operation()).toMatchObject({success:false,error:{code:"NOT_INITIALIZED"}});
  }
  expect(native.connect).not.toHaveBeenCalled();
});

test("cleans up partial native event registration", async () => {
  const native = fakeNative();
  const remove = jest.fn();
  native.addListener.mockImplementationOnce(() => ({remove})).mockImplementationOnce(() => {throw new Error("not ready")});
  const client = createWhatsAppClient(() => native);
  expect(await client.initialize()).toMatchObject({success:false,error:{code:"MODULE_UNAVAILABLE"}});
  expect(remove).toHaveBeenCalledTimes(1);
});

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

// IT-ID-07: IDENTITY_UNAVAILABLE reaches error listeners with a sanitized message and leaves the connection untouched.
test("identity unavailable is an informational error that does not change connection state", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const status = jest.fn();
  const error = jest.fn();
  client.addListener("connectionChanged", status);
  client.addListener("error", error);
  native.handlers.get("connectionChanged")?.({ state: "connected" });
  native.handlers.get("error")?.({ code: "IDENTITY_UNAVAILABLE", message: "secret 34600@s.whatsapp.net" });
  await Promise.resolve();
  expect(error).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith({ code: "IDENTITY_UNAVAILABLE", message: "WhatsApp identity is unavailable" });
  expect(status).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith({ state: "connected" });
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

test("removing one registration keeps an identical callback registered elsewhere", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const listener = jest.fn();
  const first = client.addListener("connectionChanged", listener);
  client.addListener("connectionChanged", listener);
  await Promise.resolve();
  listener.mockClear();
  first.remove();
  native.handlers.get("connectionChanged")?.({ state: "connected" });
  expect(listener).toHaveBeenCalledTimes(1);
});

test("failed option update requires a fresh native initialization", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  native.initialize.mockResolvedValueOnce({ success: false, error: { code: "SESSION_STORAGE_FAILED" } });
  expect(await client.initialize({ maxRecoveryBufferBytes: 1234 })).toMatchObject({ success: false });
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "NOT_INITIALIZED" } });
  expect(await client.initialize()).toEqual({ success: true, data: undefined });
  expect(native.initialize).toHaveBeenCalledTimes(3);
});

const deliveryId = `wa-delivery:v1:${"a".repeat(32)}`;
const received = (consumer?: string) => ({
  deliveryId,
  message: { id: "wa-message:v1:YWJj", accountId: "1@lid", whatsappMessageId: "m", chatId: "2@lid", direction: "incoming", timestamp: 1, text: "hola" },
  ...(consumer ? { consumer } : {}),
});
const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

// UT-SUB-01 / IT-SUB-01: registering before or after preparation activates local recovery once storage is ready.
test("registers the consumer with native only once local storage is prepared", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  client.addListener("messageReceived", jest.fn()); // before initialize()
  await flush();
  expect(native.setMessageConsumer).not.toHaveBeenCalled();
  await client.initialize();
  await flush();
  expect(native.setMessageConsumer).toHaveBeenCalledTimes(1);
  client.addListener("messageReceived", jest.fn()); // after
  await flush();
  expect(native.setMessageConsumer).toHaveBeenCalledTimes(2);
  expect(native.connect).not.toHaveBeenCalled();
});

// UT-SUB-02 / UT-SUB-03 / IT-SUB-02 / IT-SUB-03: the newest subscription is the only consumer; stale remove() and emissions are ignored.
test("replaces the consumer and ignores the replaced subscription's remove and queued emissions", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const first = jest.fn();
  const second = jest.fn();
  const oldSubscription = client.addListener("messageReceived", first);
  await flush();
  const oldToken = native.setMessageConsumer.mock.calls[0][0];
  client.addListener("messageReceived", second);
  await flush();
  const newToken = native.setMessageConsumer.mock.calls[1][0];
  expect(newToken).not.toBe(oldToken);
  expect(native.removeMessageConsumer).not.toHaveBeenCalled(); // replacement is atomic: no remove-then-set window
  oldSubscription.remove(); // stale: must not retire the current consumer
  expect(native.removeMessageConsumer).not.toHaveBeenCalled();
  native.handlers.get("messageReceived")?.(received(oldToken)); // queued for the replaced consumer
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  native.handlers.get("messageReceived")?.(received(newToken));
  expect(second).toHaveBeenCalledTimes(1);
  expect(second.mock.calls[0][0]).toEqual({ deliveryId, message: received().message }); // the routing token is not public
  expect(first).not.toHaveBeenCalled();
});

// UT-SUB-04 / IT-SUB-04: a confirmation by deliveryId is valid whichever consumer started it.
test("accepts a late confirmation after the consumer was replaced", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  client.addListener("messageReceived", jest.fn());
  client.addListener("messageReceived", jest.fn()); // replacement
  await flush();
  expect(await client.confirmMessageStored(deliveryId)).toEqual({ success: true, data: undefined });
  expect(native.confirmMessageStored).toHaveBeenCalledWith(deliveryId);
});

// UT-SUB-07 / IT-SUB-07: subscribing recovers locally; it never connects nor clears an explicit stop.
test("subscribing after disconnect or logout requests no network and keeps the stop", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  await client.disconnect();
  await client.logout();
  native.connect.mockClear();
  client.addListener("messageReceived", jest.fn());
  await flush();
  expect(native.setMessageConsumer).toHaveBeenCalledTimes(1);
  expect(native.connect).not.toHaveBeenCalled();
});

// IT-INI-05: an invalid session leaves recovery and confirmation available.
test("registers the consumer when initialization reports an invalid session", async () => {
  const native = fakeNative();
  native.initialize.mockResolvedValueOnce({ success: false, error: { code: "SESSION_STATE_INVALID" } });
  const client = createWhatsAppClient(() => native);
  client.addListener("messageReceived", jest.fn());
  expect(await client.initialize()).toMatchObject({ success: false, error: { code: "SESSION_STATE_INVALID" } });
  await flush();
  expect(native.setMessageConsumer).toHaveBeenCalledTimes(1);
  expect(await client.confirmMessageStored(deliveryId)).toEqual({ success: true, data: undefined });
});

// UT-SUB-08 / IT-SUB-08: a failed registration is reported once and is not retried by a timer.
test("reports a failed consumer registration once without retrying", async () => {
  jest.useFakeTimers();
  try {
    const native = fakeNative();
    native.setMessageConsumer.mockResolvedValue({ success: false, error: { code: "NATIVE_CALL_FAILED", message: "secret" } });
    const client = createWhatsAppClient(() => native);
    const errors = jest.fn();
    client.addListener("error", errors);
    await client.initialize();
    client.addListener("messageReceived", jest.fn());
    await flush();
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(native.setMessageConsumer).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith({ code: "NATIVE_CALL_FAILED", message: "WhatsApp native call failed" });
  } finally {
    jest.useRealTimers();
  }
});

// IT-SUB-06: a recreated JavaScript runtime subscribes again without restarting native code.
test("a new client over the same native module recovers by subscribing", async () => {
  const native = fakeNative();
  const first = createWhatsAppClient(() => native);
  await first.initialize();
  first.addListener("messageReceived", jest.fn());
  await flush();
  const recreated = createWhatsAppClient(() => native); // destroyed and recreated runtime
  await recreated.initialize();
  const listener = jest.fn();
  recreated.addListener("messageReceived", listener);
  await flush();
  expect(native.setMessageConsumer).toHaveBeenCalledTimes(2);
  const [oldToken, newToken] = native.setMessageConsumer.mock.calls.map((call) => call[0]);
  expect(newToken).not.toBe(oldToken); // the recreated runtime never reuses the lost runtime's identity
  native.handlers.get("messageReceived")?.(received(newToken));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(native.connect).not.toHaveBeenCalled();
});

// IT-API-08: events are validated JSON contracts and carry metadata only.
test("rejects a delivery carrying image bytes", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const listener = jest.fn();
  const errors = jest.fn();
  client.addListener("messageReceived", listener);
  client.addListener("error", errors);
  const message = { ...received().message, image: { reference: { messageId: "wa-message:v1:YWJj", downloadReference: "wa-image:v1:YWJj" }, base64: "AAAA" } };
  native.handlers.get("messageReceived")?.({ deliveryId, message });
  expect(listener).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledWith({ code: "INVALID_NATIVE_RESPONSE", message: "Invalid WhatsApp native response" });
});

// UT-SUB-03: removing the active subscription retires it in native and ignores later emissions.
test("removing the active consumer unregisters it natively", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const listener = jest.fn();
  const subscription = client.addListener("messageReceived", listener);
  await flush();
  const token = native.setMessageConsumer.mock.calls[0][0];
  subscription.remove();
  expect(native.removeMessageConsumer).toHaveBeenCalledWith(token);
  native.handlers.get("messageReceived")?.(received(token));
  expect(listener).not.toHaveBeenCalled();
});

// IT-OUT-05: simultaneous logouts share one native call and one result; a repeat is requested again and stays local.
test("simultaneous logout calls share one native call and result", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  let release: (value: unknown) => void = () => {};
  native.logout.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  const first = client.logout();
  const second = client.logout();
  release({ success: false, error: { code: "REMOTE_LOGOUT_UNCONFIRMED" } });
  const results = await Promise.all([first, second]);
  expect(native.logout).toHaveBeenCalledTimes(1);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ success: false, error: { code: "REMOTE_LOGOUT_UNCONFIRMED" } });
  expect(await client.logout()).toEqual({ success: true, data: undefined });
  expect(native.logout).toHaveBeenCalledTimes(2);
});

// UT-CON-10 / IT-CON-10: connect and disconnect requested during a logout are admitted after it.
test("connect and disconnect wait for a logout in flight", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const order: string[] = [];
  let release: (value: unknown) => void = () => {};
  native.logout.mockImplementationOnce(() => new Promise((resolve) => { release = (value) => { order.push("logout"); resolve(value); }; }));
  native.connect.mockImplementationOnce(async () => { order.push("connect"); return { success: true }; });
  native.disconnect.mockImplementationOnce(async () => { order.push("disconnect"); return { success: true }; });
  const logout = client.logout();
  const connect = client.connect();
  const disconnect = client.disconnect();
  await flush();
  expect(order).toEqual([]);
  release({ success: true });
  await Promise.all([logout, connect, disconnect]);
  expect(order).toEqual(["logout", "connect", "disconnect"]);
});

// IT-OUT-03: a local failure while retiring keeps the instance's session state and reports the storage error.
test("a failed local retirement is reported and does not announce a disconnected account", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize();
  const states = jest.fn();
  client.addListener("connectionChanged", states);
  await flush();
  states.mockClear();
  native.logout.mockResolvedValueOnce({ success: false, error: { code: "SESSION_STORAGE_FAILED" } });
  expect(await client.logout()).toMatchObject({ success: false, error: { code: "SESSION_STORAGE_FAILED" } });
  await flush();
  expect(states).not.toHaveBeenCalled();
});

// WA-10 / IT-API-08: the image calls carry only the opaque reference or the message ID to native,
// and a download answers with a private file URI, a verified MIME and a measured size.
describe("private image files", () => {
  const messageId = "wa-message:v1:YWJj";
  const reference = { messageId, downloadReference: "wa-image:v1:YWJj" };
  const image = { uri: "file:///data/user/0/app/files/whatsapp/images/ab12.img", mimeType: "image/jpeg", size: 2048 };

  async function ready() {
    const native = fakeNative();
    const client = createWhatsAppClient(() => native);
    await client.initialize();
    return { native, client };
  }

  test("IT-IMG-06: returns the verified file and sends only the opaque reference", async () => {
    const { native, client } = await ready();
    native.downloadImage.mockResolvedValueOnce({ success: true, data: image });
    expect(await client.downloadImage(reference)).toEqual({ success: true, data: image });
    expect(native.downloadImage).toHaveBeenCalledWith(reference);
    native.deleteDownloadedImage.mockClear();
    expect(await client.deleteDownloadedImage(messageId)).toMatchObject({ success: true });
    expect(native.deleteDownloadedImage).toHaveBeenCalledWith(messageId);
  });

  test("UT-IMG-02: rejects malformed references before native is called", async () => {
    const { native, client } = await ready();
    const bad = [
      { messageId, downloadReference: "wa-image:v2:YWJj" },
      { messageId, downloadReference: `wa-image:v1:${"A".repeat(16 * 1024)}` },
      { messageId, downloadReference: "wa-image:v1:a b" },
      { messageId: "../../etc/passwd", downloadReference: "wa-image:v1:YWJj" },
      { ...reference, path: "/etc/passwd" },
      { messageId },
    ];
    for (const value of bad) {
      expect(await client.downloadImage(value as never)).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    }
    expect(await client.deleteDownloadedImage("file:///etc/passwd")).toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
    expect(native.downloadImage).not.toHaveBeenCalled();
    expect(native.deleteDownloadedImage).not.toHaveBeenCalled();
  });

  test("IT-IMG-04/05/09/10/12: every image error code keeps its meaning and drops native text", async () => {
    const { native, client } = await ready();
    for (const code of ["IMAGE_UNAVAILABLE", "ACCOUNT_NOT_CONNECTED", "STORAGE_LIMIT_REACHED", "IMAGE_DOWNLOAD_FAILED", "INVALID_INPUT"] as const) {
      native.downloadImage.mockResolvedValueOnce({ success: false, error: { code, message: "wa-image:v1:secret-key" } });
      const result = await client.downloadImage(reference);
      expect(result).toMatchObject({ success: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain("secret-key");
    }
    native.deleteDownloadedImage.mockResolvedValueOnce({ success: false, error: { code: "IMAGE_DELETE_FAILED", message: "/private/path" } });
    const failed = await client.deleteDownloadedImage(messageId);
    expect(failed).toMatchObject({ success: false, error: { code: "IMAGE_DELETE_FAILED" } });
    expect(JSON.stringify(failed)).not.toContain("/private/path");
  });

  test("IT-IMG-06/07: an answer without a verified private file is not a success", async () => {
    const { native, client } = await ready();
    for (const data of [
      undefined,
      { ...image, uri: "https://example.com/a.jpg" },
      { ...image, uri: "" },
      { ...image, mimeType: "text/html" },
      { ...image, mimeType: "" },
      { ...image, size: 0 },
      { ...image, size: -1 },
      { ...image, size: 1.5 },
      { ...image, base64: "AAAA" },
      { uri: image.uri, size: 1 },
    ]) {
      native.downloadImage.mockResolvedValueOnce({ success: true, data });
      expect(await client.downloadImage(reference)).toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE" } });
    }
  });

  test("a delete answer carrying data is not a success", async () => {
    const { native, client } = await ready();
    native.deleteDownloadedImage.mockResolvedValueOnce({ success: true, data: { freed: 1 } });
    expect(await client.deleteDownloadedImage(messageId)).toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE" } });
  });

  test("IT-IMG-17: downloads neither wait for nor block confirmations", async () => {
    const { native, client } = await ready();
    let finish!: (value: unknown) => void;
    native.downloadImage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = client.downloadImage(reference);
    expect(await client.confirmMessageStored(`wa-delivery:v1:${"b".repeat(32)}`)).toMatchObject({ success: true });
    expect(await client.logout()).toMatchObject({ success: true });
    finish({ success: true, data: image });
    expect(await pending).toMatchObject({ success: true });
    native.downloadImage.mockResolvedValueOnce({ success: true, data: image });
    expect(await client.downloadImage(reference)).toMatchObject({ success: true });
  });

  test("a call before initialization or without the module keeps its own error", async () => {
    const client = createWhatsAppClient(() => null);
    expect(await client.downloadImage(reference)).toMatchObject({ success: false, error: { code: "MODULE_UNAVAILABLE" } });
    expect(await client.deleteDownloadedImage(messageId)).toMatchObject({ success: false, error: { code: "MODULE_UNAVAILABLE" } });
  });
});
