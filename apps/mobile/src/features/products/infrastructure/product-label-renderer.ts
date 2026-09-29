import { Asset } from "expo-asset";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Skia } from "@shopify/react-native-skia";
import QRCode from "qrcode";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { RenderError } from "@mobile/features/printing/application/contracts";
import type { RenderProfile, RenderedDocument } from "@mobile/features/printing/domain/printing";
import type { ProductLabel } from "@mobile/features/products/domain/product-label";
import { fitLabelLines } from "@mobile/features/products/infrastructure/label-text";

const fontAsset = require("../../../../assets/fonts/InterVariable.ttf");
let fontData: Promise<Awaited<ReturnType<typeof Skia.Data.fromURI>>> | null = null;

async function typeface() {
  fontData ??= Asset.fromModule(fontAsset).downloadAsync().then((asset) => Skia.Data.fromURI(asset.localUri!)).catch((error) => { fontData = null; throw error; });
  const data = await fontData;
  const font = Skia.Typeface.MakeFreeTypeFaceFromData(data);
  if (!font) throw new Error("Could not load label font");
  return font;
}

export async function renderProductLabel(label: ProductLabel, profile: RenderProfile): Promise<Result<RenderedDocument, RenderError>> {
  const { widthPx, heightPx, dpiX, dpiY } = profile;
  if (![widthPx, heightPx].every((value) => Number.isSafeInteger(value) && value > 0) || ![dpiX, dpiY].every((value) => Number.isFinite(value) && value > 0)) {
    return err({ code: "UNSUPPORTED_FORMAT", message: "Invalid label profile" });
  }
  let file: File | null = null;
  try {
    const face = await typeface();
    const qr = QRCode.create(label.qrCode, { errorCorrectionLevel: "M" }).modules;
    const margin = Math.ceil(dpiX / 25.4);
    const qrPixels = Math.min(heightPx - 2 * margin, Math.floor(widthPx * 0.39));
    const modulePixels = Math.floor(qrPixels / (qr.size + 8));
    if (modulePixels < 1) return err({ code: "UNSUPPORTED_FORMAT", message: "Label is too small for its QR code" });
    const qrSize = modulePixels * (qr.size + 8);
    const qrX = margin;
    const qrY = Math.floor((heightPx - qrSize) / 2);
    const textX = qrX + qrSize + margin;
    const textWidth = widthPx - textX - margin;
    if (textWidth <= 0) return err({ code: "LABEL_CONTENT_OVERFLOW", message: "No space for label text" });
    const nameFont = Skia.Font(face, 9 * dpiY / 72);
    const skuFont = Skia.Font(face, 8 * dpiY / 72);
    const nameHeight = Math.ceil(nameFont.getSize() * 1.16);
    const skuHeight = Math.ceil(skuFont.getSize() * 1.16);
    const gap = Math.ceil(dpiY / 25.4);
    const nameLines = fitLabelLines(label.productName, textWidth, (text) => nameFont.getTextWidth(text), 2, true);
    const skuLines = label.sku ? fitLabelLines(label.sku, textWidth, (text) => skuFont.getTextWidth(text), 3, false) : [];
    if (!nameLines || !skuLines || nameLines.length * nameHeight + (skuLines.length ? gap + skuLines.length * skuHeight : 0) > heightPx - 2 * margin) {
      return err({ code: "LABEL_CONTENT_OVERFLOW", message: "Label text does not fit on this paper" });
    }
    const surface = Skia.Surface.MakeOffscreen(widthPx, heightPx);
    if (!surface) return err({ code: "RENDER_FAILED", message: "Could not create label image" });
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("white"));
    const paint = Skia.Paint();
    paint.setColor(Skia.Color("black"));
    paint.setAntiAlias(false);
    for (let row = 0; row < qr.size; row++) for (let col = 0; col < qr.size; col++) {
      if (qr.get(row, col)) canvas.drawRect(Skia.XYWHRect(qrX + (col + 4) * modulePixels, qrY + (row + 4) * modulePixels, modulePixels, modulePixels), paint);
    }
    paint.setAntiAlias(true);
    let baseline = margin + nameHeight;
    for (const line of nameLines) { canvas.drawText(line, textX, baseline, paint, nameFont); baseline += nameHeight; }
    baseline += gap;
    for (const line of skuLines) { canvas.drawText(line, textX, baseline, paint, skuFont); baseline += skuHeight; }
    surface.flush();
    const png = surface.makeImageSnapshot().encodeToBytes();
    file = new File(Paths.cache, `yoyos-label-${Crypto.randomUUID()}.png`);
    file.write(png);
    return ok({ uri: file.uri, widthPx, heightPx });
  } catch {
    try { if (file?.exists) file.delete(); } catch { /* Preserve the render failure. */ }
    return err({ code: "RENDER_FAILED", message: "Could not render product label" });
  }
}
