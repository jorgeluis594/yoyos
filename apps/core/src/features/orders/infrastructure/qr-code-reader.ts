import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";

export type QrCodeReadError = Readonly<{ code: "UNREADABLE_IMAGE" | "QR_READER_UNAVAILABLE"; message: string }>;
export type ReadQrCodes = (
  image: Readonly<{ bytes: Uint8Array; contentType: string }>,
) => Promise<Result<readonly string[], QrCodeReadError>>;

let ready: Promise<unknown> | undefined;
const init = () => (ready ??= readFile(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"))
  .then((binary) => prepareZXingModule({
    overrides: { wasmBinary: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) },
    fireImmediately: true,
  }))
  .catch((cause) => { ready = undefined; throw cause; }));

export const readQrCodes: ReadQrCodes = async ({ bytes }) => {
  try { await init(); } catch { return err({ code: "QR_READER_UNAVAILABLE", message: "QR reader unavailable" }); }
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 24_000_000 })
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const found = await readBarcodes(
      { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, colorSpace: "srgb" },
      { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 20 },
    );
    return ok(found.filter((result) => result.isValid).map((result) => result.text));
  } catch {
    return err({ code: "UNREADABLE_IMAGE", message: "Unreadable image" });
  }
};
