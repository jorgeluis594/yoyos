// Regenerates the QR photos: node src/features/orders/infrastructure/qr-fixtures/generate-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";

const out = dirname(fileURLToPath(import.meta.url));
const wasm = readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/writer/zxing_writer.wasm"));
await prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true });

const VARIANT_ID = "3f2b8c1e-5a47-4d0e-9b6a-1c7d2e8f4a90";
const SECOND_ID = "9d4e7a12-6b3c-4f85-a0d1-52e8c9b7f316";

// Same encoding as the mobile label renderer: 36-char UUID, error correction M (QR version 3).
async function qr(text, moduleSize) {
  const { image } = await writeBarcode(text, { format: "QRCode", ecLevel: "M", scale: 1, withQuietZones: true });
  const png = Buffer.from(await image.arrayBuffer());
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  return sharp(data, { raw: info }).resize(info.width * moduleSize, info.height * moduleSize, { kernel: "nearest" }).png().toBuffer();
}
const white = (w, h) => ({ create: { width: w, height: h, channels: 3, background: "#ffffff" } });
const save = async (name, pipeline) => {
  await pipeline.clone().jpeg({ quality: 90 }).toFile(join(out, `${name}.jpg`));
};

const one = await qr(VARIANT_ID, 8);
const two = await qr(SECOND_ID, 8);
const url = await qr("https://example.com/pay/yape", 8);
const size = (await sharp(one).metadata()).width;

await save("one-qr", sharp(white(800, 600)).composite([{ input: one, left: 250, top: 150 }]));
await sharp(white(800, 600)).composite([{ input: one, left: 250, top: 150 }]).webp({ quality: 90 }).toFile(join(out, "one-qr.webp"));
await save("two-qr", sharp(white(1000, 500)).composite([{ input: one, left: 80, top: 100 }, { input: two, left: 600, top: 100 }]));
await save("no-qr", sharp({ create: { width: 800, height: 600, channels: 3, background: "#c8b89a" } }).blur(8));
await save("non-uuid-qr", sharp(white(800, 600)).composite([{ input: url, left: 250, top: 150 }]));

// Printed label: QR on the left, product name and SKU on the right, photographed at a slight angle.
const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${size + 80}"><rect width="100%" height="100%" fill="#fff"/>
<text x="${size + 60}" y="140" font-family="sans-serif" font-size="42" font-weight="bold">Camisa lino</text>
<text x="${size + 60}" y="200" font-family="sans-serif" font-size="34">SKU CAM-001-AZ</text></svg>`);
const flat = await sharp(label).composite([{ input: one, left: 40, top: 40 }]).png().toBuffer();
await save("label", sharp(white(1200, 900)).composite([{ input: await sharp(flat).rotate(4, { background: "#ffffff" }).toBuffer(), left: 100, top: 120 }]));
console.log(`label QR encodes ${VARIANT_ID}`);
