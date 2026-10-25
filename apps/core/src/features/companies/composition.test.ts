import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";

const readImageBytes = vi.hoisted(() => vi.fn());
const readQrCodes = vi.hoisted(() => vi.fn());
vi.mock("@core/src/shared/images", () => ({ readImageBytes }));
vi.mock("@core/src/shared/images/infrastructure/qr-code-reader", () => ({ readQrCodes }));

const imageId = "00000000-0000-4000-8000-000000000001";
const context = { companyId: "company", stage: "save" } as never;
const bytes = { bytes: new Uint8Array([1]), contentType: "image/jpeg" };

async function load(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return (await import("@core/src/features/companies/composition")).detectQrCode;
}

beforeEach(() => { readImageBytes.mockReset(); readQrCodes.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

test("a timed-out image read answers qr check unavailable and frees its slot", async () => {
  const detectQrCode = await load({ PAYMENT_QR_CHECK_SLOTS: "1", PAYMENT_QR_CHECK_READ_TIMEOUT_MS: "20" });
  readImageBytes.mockImplementationOnce((_id: string, options: { signal: AbortSignal }) => new Promise((resolve) =>
    options.signal.addEventListener("abort", () => resolve(err({ code: "IMAGE_STORAGE_UNAVAILABLE", storageCode: "IMAGE_STORAGE_TIMEOUT", message: "aborted" })))));
  expect(await detectQrCode(imageId as never, context)).toMatchObject({ success: false, error: { code: "QR_CHECK_UNAVAILABLE" } });
  readImageBytes.mockResolvedValueOnce(ok(bytes));
  readQrCodes.mockResolvedValueOnce(ok(["https://qr"]));
  expect(await detectQrCode(imageId as never, context)).toEqual(ok("qr_found"));
});

test("choose-time and save checks share one process-wide limit", async () => {
  const detectQrCode = await load({ PAYMENT_QR_CHECK_SLOTS: "1", PAYMENT_QR_CHECK_READ_TIMEOUT_MS: "10000" });
  let release!: () => void;
  readImageBytes.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(ok(bytes)); }));
  readQrCodes.mockResolvedValue(ok([]));
  const choosing = detectQrCode(imageId as never, { companyId: "company", stage: "choose" } as never);
  expect(await detectQrCode(imageId as never, context)).toMatchObject({ success: false, error: { code: "QR_CHECK_UNAVAILABLE" } });
  expect(readImageBytes).toHaveBeenCalledTimes(1);
  release();
  expect(await choosing).toEqual(ok("no_qr"));
});

test("maps unreadable images and missing images", async () => {
  const detectQrCode = await load({});
  readImageBytes.mockResolvedValue(ok(bytes));
  readQrCodes.mockResolvedValueOnce(err({ code: "UNREADABLE_IMAGE", message: "x" }));
  expect(await detectQrCode(imageId as never, context)).toEqual(ok("no_qr"));
  readQrCodes.mockResolvedValueOnce(err({ code: "QR_READER_UNAVAILABLE", message: "x" }));
  expect(await detectQrCode(imageId as never, context)).toMatchObject({ success: false, error: { code: "QR_CHECK_UNAVAILABLE" } });
  readImageBytes.mockResolvedValueOnce(err({ code: "IMAGE_NOT_FOUND", message: "x" }));
  expect(await detectQrCode(imageId as never, context)).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
});
