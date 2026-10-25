import { Asset } from "expo-asset";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Skia } from "@shopify/react-native-skia";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { layoutDispatchLabel, type DispatchLabelGeometry, type DispatchLabelLayout, type DispatchLabelWeight, type MeasureText } from "@shared/dispatch-label/layout";
import type { RenderError } from "@mobile/features/printing/application/contracts";
import type { RenderProfile, RenderedDocument } from "@mobile/features/printing/domain/printing";
import type { DispatchLabel } from "@shared/dispatch-label/types";
import { typeface } from "@mobile/features/products/infrastructure/product-label-renderer";

const boldAsset = require("../../../../assets/fonts/Inter-Bold.ttf");
let boldData: Promise<Awaited<ReturnType<typeof Skia.Data.fromURI>>> | null = null;
// Same padding as the 62 x 100 mm roll in the web PDF.
const paddingMm = 2;

async function boldTypeface() {
  boldData ??= Asset.fromModule(boldAsset).downloadAsync().then((asset) => Skia.Data.fromURI(asset.localUri!)).catch((error) => { boldData = null; throw error; });
  const face = Skia.Typeface.MakeFreeTypeFaceFromData(await boldData);
  if (!face) throw new Error("Could not load bold label font");
  return face;
}

async function typefaces(): Promise<Record<DispatchLabelWeight, NonNullable<ReturnType<typeof Skia.Typeface.MakeFreeTypeFaceFromData>>>> {
  const [regular, bold] = await Promise.all([typeface(), boldTypeface()]);
  return { regular, bold };
}

const geometryOf = (profile: RenderProfile): DispatchLabelGeometry => ({ ...profile, paddingMm });

async function measurer(profile: RenderProfile): Promise<MeasureText> {
  const faces = await typefaces();
  return (text, sizePt, weight) => Skia.Font(faces[weight], sizePt * profile.dpiY / 72).getTextWidth(text);
}

/** Preflight: tells whether the label fits before anything is sent to the printer. */
export async function measureDispatchLabel(label: DispatchLabel, profile: RenderProfile): Promise<Result<DispatchLabelLayout, RenderError>> {
  try {
    return layoutDispatchLabel(label, geometryOf(profile), await measurer(profile));
  } catch {
    return err({ code: "RENDER_FAILED", message: "Could not measure dispatch label" });
  }
}

/** Loads the font once and returns a synchronous "does it fit" check for the preflight of a whole selection. */
export async function createDispatchLabelFit(profile: RenderProfile): Promise<(label: DispatchLabel) => boolean> {
  const measure = await measurer(profile);
  return (label) => layoutDispatchLabel(label, geometryOf(profile), measure).success;
}

export async function renderDispatchLabel(label: DispatchLabel, profile: RenderProfile): Promise<Result<RenderedDocument, RenderError>> {
  const { widthPx, heightPx, dpiX, dpiY } = profile;
  if (![widthPx, heightPx].every((value) => Number.isSafeInteger(value) && value > 0) || ![dpiX, dpiY].every((value) => Number.isFinite(value) && value > 0)) {
    return err({ code: "UNSUPPORTED_FORMAT", message: "Invalid label profile" });
  }
  let file: File | null = null;
  try {
    const faces = await typefaces();
    const font = (sizePt: number, weight: DispatchLabelWeight) => Skia.Font(faces[weight], sizePt * dpiY / 72);
    const layout = layoutDispatchLabel(label, geometryOf(profile), (text, sizePt, weight) => font(sizePt, weight).getTextWidth(text));
    if (!layout.success) return layout;
    const surface = Skia.Surface.MakeOffscreen(widthPx, heightPx);
    if (!surface) return err({ code: "RENDER_FAILED", message: "Could not create label image" });
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("white"));
    const paint = Skia.Paint();
    paint.setColor(Skia.Color("black"));
    paint.setAntiAlias(true);
    for (const rule of layout.data.rules) canvas.drawRect(Skia.XYWHRect(rule.x1, rule.y - rule.thickness / 2, rule.x2 - rule.x1, Math.max(1, rule.thickness)), paint);
    for (const line of layout.data.lines) canvas.drawText(line.text, line.x, line.y, paint, font(line.sizePt, line.weight));
    surface.flush();
    file = new File(Paths.cache, `yoyos-dispatch-label-${Crypto.randomUUID()}.png`);
    file.write(surface.makeImageSnapshot().encodeToBytes());
    return ok({ uri: file.uri, widthPx, heightPx });
  } catch {
    try { if (file?.exists) file.delete(); } catch { /* Preserve the render failure. */ }
    return err({ code: "RENDER_FAILED", message: "Could not render dispatch label" });
  }
}
