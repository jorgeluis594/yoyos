import { createWhatsAppClient } from "@mobile/modules/whatsapp/client";

function fakeNative() {
  const handlers = new Map<string, (value: unknown) => void>();
  return {
    handlers,
    addListener: jest.fn((event: string, callback: (value: unknown) => void) => { handlers.set(event, callback); return { remove() {} }; }),
    initialize: jest.fn().mockResolvedValue({ success: true, data: { state: "disconnected" } }),
    connect: jest.fn().mockResolvedValue({ success: true }),
    disconnect: jest.fn().mockResolvedValue({ success: true }),
    logout: jest.fn().mockResolvedValue({ success: true }),
    confirmMessageStored: jest.fn().mockResolvedValue({ success: true }),
    setMessageConsumer: jest.fn().mockResolvedValue({ success: true }),
    removeMessageConsumer: jest.fn().mockResolvedValue({ success: true }),
    downloadImage: jest.fn(),
    deleteDownloadedImage: jest.fn().mockResolvedValue({ success: true }),
  };
}
const emit = (native: ReturnType<typeof fakeNative>, event: string, payload: unknown) => native.handlers.get(event)!(payload);
const reference = { messageId: "wa-message:v1:YWJj", downloadReference: "wa-image:v1:YWJj" };

// IT-IOS-01 on the JavaScript side: suspension and resumption arrive as ordinary connection events,
// so a QR from before the suspension never comes back and nothing is replayed to a late subscriber.
describe("IT-IOS-01 suspension and resumption", () => {
  test("a QR shown before suspension is dropped and a late QR from that attempt is ignored", async () => {
    let clock = 1_000;
    const native = fakeNative();
    const client = createWhatsAppClient(() => native, () => clock);
    await client.initialize();
    const qrs: string[] = [];
    client.addListener("qr", (qr) => qrs.push(qr.value));
    emit(native, "connectionChanged", { state: "awaitingQr" });
    emit(native, "qr", { value: "before", expiresAt: clock + 60_000 });
    emit(native, "connectionChanged", { state: "disconnected" }); // native suspended the attempt
    emit(native, "qr", { value: "late", expiresAt: clock + 60_000 });
    clock += 120_000; // the app stayed suspended
    emit(native, "connectionChanged", { state: "connecting" });
    emit(native, "qr", { value: "expired", expiresAt: clock - 1 });
    emit(native, "connectionChanged", { state: "awaitingQr" });
    emit(native, "qr", { value: "after", expiresAt: clock + 60_000 });
    expect(qrs).toEqual(["before", "after"]);
    const replayed: string[] = [];
    client.addListener("qr", (qr) => replayed.push(qr.value));
    await Promise.resolve();
    expect(replayed).toEqual(["after"]);
  });

  test("reconnecting after resume is announced once and connect is not called again", async () => {
    const native = fakeNative();
    const client = createWhatsAppClient(() => native);
    await client.initialize();
    await client.connect();
    const states: string[] = [];
    client.addListener("connectionChanged", (s) => states.push(s.state));
    emit(native, "connectionChanged", { state: "connected" });
    emit(native, "connectionChanged", { state: "disconnected" });
    emit(native, "connectionChanged", { state: "reconnecting" });
    emit(native, "connectionChanged", { state: "connected" });
    expect(states.slice(-4)).toEqual(["connected", "disconnected", "reconnecting", "connected"]);
    expect(native.connect).toHaveBeenCalledTimes(1);
  });

  test("a download cancelled by suspension surfaces its own code and the next one works after resume", async () => {
    const native = fakeNative();
    native.downloadImage
      .mockResolvedValueOnce({ success: false, error: { code: "IMAGE_DOWNLOAD_FAILED", message: "secret" } })
      .mockResolvedValueOnce({ success: true, data: { uri: "file:///private/a.img", mimeType: "image/jpeg", size: 10 } });
    const client = createWhatsAppClient(() => native);
    await client.initialize();
    expect(await client.downloadImage(reference)).toEqual({ success: false, error: { code: "IMAGE_DOWNLOAD_FAILED", message: "WhatsApp image download failed" } });
    expect(await client.downloadImage(reference)).toMatchObject({ success: true, data: { size: 10 } });
  });

  test("a message consumer stays registered across suspension and a native session refusal is explicit", async () => {
    const native = fakeNative();
    const client = createWhatsAppClient(() => native);
    await client.initialize();
    const errors: string[] = [];
    client.addListener("error", (e) => errors.push(e.code));
    client.addListener("messageReceived", () => {});
    await Promise.resolve();
    emit(native, "connectionChanged", { state: "disconnected" });
    emit(native, "error", { code: "SESSION_EXPIRED", message: "secret" });
    expect(native.setMessageConsumer).toHaveBeenCalledTimes(1);
    expect(native.removeMessageConsumer).not.toHaveBeenCalled();
    expect(errors).toEqual(["SESSION_EXPIRED"]);
  });
});
