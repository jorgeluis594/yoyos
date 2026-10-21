// Renders the committed raster assets of public/ from the brand SVGs and og-image.svg.
// Run from landing/: node assets-src/render-assets.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";

const read = (path) => readFileSync(new URL(path, import.meta.url));
const background = "#F7F4EF";

async function squareIcon(size, fill, path) {
  const inner = Math.round(size * fill);
  const mark = await sharp(read("../src/assets/brand/yoyos-isotipo.svg"), { density: 300 })
    .resize({ width: inner, height: inner, fit: "inside" })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(new URL(path, import.meta.url).pathname);
}

async function logo512(path) {
  await sharp(read("../src/assets/brand/yoyos-isotipo.svg"), { density: 300 })
    .resize({ width: 512, height: 512, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(new URL(path, import.meta.url).pathname);
}

async function ogImage(path) {
  const logo = await sharp(read("../src/assets/brand/yoyos-logo-light.svg"), { density: 300 })
    .resize({ height: 72, fit: "inside" })
    .toBuffer();
  await sharp(read("./og-image.svg"))
    .composite([{ input: logo, left: 96, top: 120 }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(new URL(path, import.meta.url).pathname);
}

await squareIcon(192, 0.7, "../public/icon-192.png");
await squareIcon(512, 0.7, "../public/icon-512.png");
await logo512("../public/logo-512.png");
await ogImage("../public/og/yoyos-1200x630.png");
