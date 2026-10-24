import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Skia } from "@shopify/react-native-skia";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { layoutDispatchLabel, type DispatchLabelLayout, type MeasureText } from "@shared/dispatch-label/layout";
import type { RenderError } from "@mobile/features/printing/application/contracts";
import type { RenderProfile, RenderedDocument } from "@mobile/features/printing/domain/printing";
import type { DispatchLabel } from "@shared/dispatch-label/types";
import { typeface } from "@mobile/features/products/infrastructure/product-label-renderer";

async function measurer(profile: RenderProfile): Promise<MeasureText> {
  const face = await typeface();
  return (text, sizePt) => Skia.Font(face, sizePt * profile.dpiY / 72).getTextWidth(text);
}

/** Preflight: tells whether the label fits before anything is sent to the printer. */
export async function measureDispatchLabel(label: DispatchLabel, profile: RenderProfile): Promise<Result<DispatchLabelLayout, RenderError>> {
  try {
    return layoutDispatchLabel(label, profile, await measurer(profile));
  } catch {
    return err({ code: "RENDER_FAILED", message: "Could not measure dispatch label" });
  }
}

/** Loads the font once and returns a synchronous "does it fit" check for the preflight of a whole selection. */
export async function createDispatchLabelFit(profile: RenderProfile): Promise<(label: DispatchLabel) => boolean> {
  const measure = await measurer(profile);
  return (label) => layoutDispatchLabel(label, profile, measure).success;
}

export async function renderDispatchLabel(label: DispatchLabel, profile: RenderProfile): Promise<Result<RenderedDocument, RenderError>> {
  const { widthPx, heightPx, dpiX, dpiY } = profile;
  if (![widthPx, heightPx].every((value) => Number.isSafeInteger(value) && value > 0) || ![dpiX, dpiY].every((value) => Number.isFinite(value) && value > 0)) {
    return err({ code: "UNSUPPORTED_FORMAT", message: "Invalid label profile" });
  }
  let file: File | null = null;
  try {
    const face = await typeface();
    const layout = layoutDispatchLabel(label, profile, (text, sizePt) => Skia.Font(face, sizePt * dpiY / 72).getTextWidth(text));
    if (!layout.success) return layout;
    const surface = Skia.Surface.MakeOffscreen(widthPx, heightPx);
    if (!surface) return err({ code: "RENDER_FAILED", message: "Could not create label image" });
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("white"));
    const paint = Skia.Paint();
    paint.setColor(Skia.Color("black"));
    paint.setAntiAlias(true);
    const margin = Math.ceil(dpiX / 25.4);
    for (const line of layout.data.lines) canvas.drawText(line.text, margin, line.y, paint, Skia.Font(face, line.sizePt * dpiY / 72));
    surface.flush();
    file = new File(Paths.cache, `yoyos-dispatch-label-${Crypto.randomUUID()}.png`);
    file.write(surface.makeImageSnapshot().encodeToBytes());
    return ok({ uri: file.uri, widthPx, heightPx });
  } catch {
    try { if (file?.exists) file.delete(); } catch { /* Preserve the render failure. */ }
    return err({ code: "RENDER_FAILED", message: "Could not render dispatch label" });
  }
}
