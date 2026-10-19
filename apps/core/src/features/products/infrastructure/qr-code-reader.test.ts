import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const fixture = async (name: string) => new Uint8Array(await readFile(join(import.meta.dirname, "qr-fixtures", name)));
const VARIANT_ID = "3f2b8c1e-5a47-4d0e-9b6a-1c7d2e8f4a90";
const SECOND_ID = "9d4e7a12-6b3c-4f85-a0d1-52e8c9b7f316";

afterEach(() => { vi.resetModules(); vi.doUnmock("node:fs/promises"); });

describe("readQrCodes", () => {
  test("reads the variant UUID from a printed label photo", async () => {
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    expect(await readQrCodes({ bytes: await fixture("label.jpg"), contentType: "image/jpeg" })).toEqual({ success: true, data: [VARIANT_ID] });
  });

  test("reads two QR codes from one photo", async () => {
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    const result = await readQrCodes({ bytes: await fixture("two-qr.jpg"), contentType: "image/jpeg" });
    expect(result.success && [...result.data].sort()).toEqual([VARIANT_ID, SECOND_ID].sort());
  });

  test("reads a QR code from a WebP image", async () => {
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    expect(await readQrCodes({ bytes: await fixture("one-qr.webp"), contentType: "image/webp" })).toEqual({ success: true, data: [VARIANT_ID] });
  });

  test("returns no codes for a photo without QR codes", async () => {
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    expect(await readQrCodes({ bytes: await fixture("no-qr.jpg"), contentType: "image/jpeg" })).toEqual({ success: true, data: [] });
  });

  test("returns non-UUID QR text unchanged", async () => {
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    expect(await readQrCodes({ bytes: await fixture("non-uuid-qr.jpg"), contentType: "image/jpeg" })).toEqual({ success: true, data: ["https://example.com/pay/yape"] });
  });

  test("returns UNREADABLE_IMAGE for bytes that are not an image or exceed the pixel limit", async () => {
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    const sharp = (await import("sharp")).default;
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "#fff" } }).png().toBuffer();
    for (const bytes of [new Uint8Array([1, 2, 3, 4]), new Uint8Array(huge)]) {
      expect(await readQrCodes({ bytes, contentType: "image/png" })).toMatchObject({ success: false, error: { code: "UNREADABLE_IMAGE" } });
    }
  });

  test("returns QR_READER_UNAVAILABLE when the WASM module cannot load and retries loading on the next call", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let fail = true;
    vi.doMock("node:fs/promises", () => ({ ...actual, readFile: (...args: Parameters<typeof actual.readFile>) => fail ? Promise.reject(new Error("disk")) : actual.readFile(...args) }));
    const { readQrCodes } = await import("@core/src/features/products/infrastructure/qr-code-reader");
    const input = { bytes: await fixture("one-qr.jpg"), contentType: "image/jpeg" };
    expect(await readQrCodes(input)).toMatchObject({ success: false, error: { code: "QR_READER_UNAVAILABLE" } });
    fail = false;
    expect(await readQrCodes(input)).toEqual({ success: true, data: [VARIANT_ID] });
  });
});
