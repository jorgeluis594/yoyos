import { createWhatsAppClient } from "@mobile/modules/whatsapp/client";

function fakeNative() {
  return {
    addListener: jest.fn(() => ({ remove() {} })),
    initialize: jest.fn().mockResolvedValue({ success: true, data: { state: "disconnected" } }),
    connect: jest.fn().mockResolvedValue({ success: true }),
    disconnect: jest.fn().mockResolvedValue({ success: true }),
    logout: jest.fn().mockResolvedValue({ success: true }),
    confirmMessageStored: jest.fn().mockResolvedValue({ success: true }),
    setMessageConsumer: jest.fn().mockResolvedValue({ success: true }),
    removeMessageConsumer: jest.fn().mockResolvedValue({ success: true }),
    downloadImage: jest.fn(),
    deleteDownloadedImage: jest.fn(),
  };
}

const MIB = 1024 * 1024;
const rejected = { success: false, error: { code: "INVALID_INPUT" } };

// UT-API-06 / IT-API-06: malformed options fail with INVALID_INPUT before native is called or anything mutates.
test.each([
  ["zero", { maxRecoveryBufferBytes: 0 }], ["negative", { maxImageStorageBytes: -1 }], ["fraction", { maxRecoveryBufferBytes: 1.5 }],
  ["unsafe", { maxRecoveryBufferBytes: Number.MAX_SAFE_INTEGER + 1 }], ["not finite", { maxImageStorageBytes: Number.POSITIVE_INFINITY }],
  ["NaN", { maxRecoveryBufferBytes: Number.NaN }], ["text", { maxRecoveryBufferBytes: "100" }], ["boolean", { maxImageStorageBytes: true }],
  ["unknown member", { maxRecoveryBufferBytes: MIB, timeoutMs: 5 }], ["null", null],
])("UT-API-06 rejects %s options before native is called", async (_name, options) => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  expect(await client.initialize(options as never)).toMatchObject(rejected);
  expect(native.initialize).not.toHaveBeenCalled();
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "NOT_INITIALIZED" } });
});

// IT-CFG-04: after a successful disconnect, new options reach native and the next connect uses them.
test("IT-CFG-04 disconnect, initialize with new options, connect", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize({ maxRecoveryBufferBytes: 10 * MIB, maxImageStorageBytes: 50 * MIB });
  expect(await client.connect()).toMatchObject({ success: true });
  expect(await client.disconnect()).toMatchObject({ success: true });
  expect(await client.initialize({ maxRecoveryBufferBytes: 4 * MIB, maxImageStorageBytes: 50 * MIB })).toMatchObject({ success: true });
  expect(native.initialize).toHaveBeenLastCalledWith({ maxRecoveryBufferBytes: 4 * MIB, maxImageStorageBytes: 50 * MIB });
  expect(await client.connect()).toMatchObject({ success: true });
  expect(native.connect).toHaveBeenCalledTimes(2);
  const calls = native.initialize.mock.calls.length;
  expect(await client.initialize({ maxRecoveryBufferBytes: 4 * MIB })).toMatchObject({ success: true }); // equivalent: defaults fill the rest
  expect(native.initialize).toHaveBeenCalledTimes(calls);
});

// IT-CFG-05: different options while reception is requested are refused by native; the running module stays usable.
test("IT-CFG-05 a refused change keeps the running module and equivalent options stay idempotent", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize({ maxRecoveryBufferBytes: 10 * MIB });
  await client.connect();
  native.initialize.mockResolvedValueOnce({ success: false, error: { code: "INVALID_INPUT", message: "secret" } });
  expect(await client.initialize({ maxRecoveryBufferBytes: 4 * MIB })).toMatchObject(rejected);
  expect(await client.connect()).toMatchObject({ success: true }); // still initialized: nothing was stopped or published
  expect(await client.disconnect()).toMatchObject({ success: true });
  const calls = native.initialize.mock.calls.length;
  expect(await client.initialize({ maxRecoveryBufferBytes: 10 * MIB, maxImageStorageBytes: 50 * MIB })).toMatchObject({ success: true });
  expect(native.initialize).toHaveBeenCalledTimes(calls); // the original options are still the active ones
});

// IT-CFG-04 / IT-CFG-08: an uncertain answer is never trusted; the next initialize reaches native, which rereads what was published.
test("IT-CFG-04/08 an uncertain answer forces a new native initialization instead of assuming either options", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  await client.initialize({ maxRecoveryBufferBytes: 10 * MIB });
  await client.disconnect();
  native.initialize.mockResolvedValueOnce({ success: false, error: { code: "SESSION_STORAGE_FAILED" } });
  expect(await client.initialize({ maxRecoveryBufferBytes: 4 * MIB })).toMatchObject({ success: false, error: { code: "SESSION_STORAGE_FAILED" } });
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "NOT_INITIALIZED" } });
  const calls = native.initialize.mock.calls.length;
  expect(await client.initialize({ maxRecoveryBufferBytes: 10 * MIB })).toMatchObject({ success: true }); // even the previous options go to native
  expect(native.initialize).toHaveBeenCalledTimes(calls + 1);
});

// IT-CFG-08: changes do not interleave; a different change during one in flight is refused and the equal one shares its result.
test("IT-CFG-08 serializes option changes", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  let finish!: (value: unknown) => void;
  native.initialize.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const first = client.initialize({ maxRecoveryBufferBytes: 4 * MIB });
  const same = client.initialize({ maxRecoveryBufferBytes: 4 * MIB });
  expect(await client.initialize({ maxRecoveryBufferBytes: 8 * MIB })).toMatchObject(rejected);
  finish({ success: true, data: { state: "disconnected" } });
  expect(await first).toMatchObject({ success: true });
  expect(await same).toMatchObject({ success: true });
  expect(native.initialize).toHaveBeenCalledTimes(1);
});

// A native answer that is not a wire-valid state is not a success, so options are not assumed applied.
test("an invalid native answer to initialize does not mark the options as applied", async () => {
  const native = fakeNative();
  const client = createWhatsAppClient(() => native);
  native.initialize.mockResolvedValueOnce({ success: true, data: { state: "banana" } });
  expect(await client.initialize({ maxRecoveryBufferBytes: 4 * MIB })).toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE" } });
  expect(await client.connect()).toMatchObject({ success: false, error: { code: "NOT_INITIALIZED" } });
});
