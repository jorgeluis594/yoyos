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

// Printed label with the geometry of apps/mobile product-label-renderer.ts: 50x25 mm at 203 dpi, QR v3-M with a 4-module quiet zone.
// Needs the mobile dependencies installed (qrcode is not a core dependency).
const QRCode = createRequire(join(out, "../../../../../../mobile/package.json"))("qrcode");
const dpi = 203;
const [widthPx, heightPx] = [Math.round(50 / 25.4 * dpi), Math.round(25 / 25.4 * dpi)];
const modules = QRCode.create(VARIANT_ID, { errorCorrectionLevel: "M" }).modules;
const margin = Math.ceil(dpi / 25.4);
const modulePx = Math.floor(Math.min(heightPx - 2 * margin, Math.floor(widthPx * 0.39)) / (modules.size + 8));
const qrSize = modulePx * (modules.size + 8);
const qrY = Math.floor((heightPx - qrSize) / 2);
const textX = margin + qrSize + margin;
const rects = [];
for (let row = 0; row < modules.size; row++) for (let col = 0; col < modules.size; col++) {
  if (modules.get(row, col)) rects.push(`<rect x="${margin + (col + 4) * modulePx}" y="${qrY + (row + 4) * modulePx}" width="${modulePx}" height="${modulePx}"/>`);
}
const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"><rect width="100%" height="100%" fill="#fff"/>${rects.join("")}
<text x="${textX}" y="${margin + 26}" font-family="sans-serif" font-size="${9 * dpi / 72}" font-weight="bold">Camisa lino</text>
<text x="${textX}" y="${margin + 60}" font-family="sans-serif" font-size="${8 * dpi / 72}">CAM-001-AZ</text></svg>`);
// Photographed: label enlarged 3x, slightly rotated, on a table.
const photo = await sharp(label).resize(widthPx * 3, heightPx * 3, { kernel: "nearest" }).rotate(4, { background: "#d8d2c4" }).png().toBuffer();
await save("label", sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#d8d2c4" } }).composite([{ input: photo, left: 150, top: 150 }]));
console.log(`label QR encodes ${VARIANT_ID}`);
