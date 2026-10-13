import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { Skia } from "@shopify/react-native-skia";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { RenderError } from "@mobile/features/printing/application/contracts";
import type { RenderProfile, RenderedDocument } from "@mobile/features/printing/domain/printing";
import type { DispatchLabel } from "@mobile/features/orders/domain/dispatch-label";
import { fitLabelLines } from "@mobile/features/products/infrastructure/label-text";
import { typeface } from "@mobile/features/products/infrastructure/product-label-renderer";

export type DispatchLabelTypography = Readonly<{ basePt: number; minPt: number; stepPt: number }>;
// shortcut: provisional sizes; the physical pilot test sets the real minimum.
export const defaultDispatchLabelTypography: DispatchLabelTypography = { basePt: 12, minPt: 7, stepPt: 0.5 };

type Block = "sender" | "recipient" | "destination" | "footer";
type Item = Readonly<{ block: Block; text: string; scale: number }>;
type PlacedLine = Readonly<{ text: string; y: number; sizePt: number }>;
export type DispatchLabelLayout = Readonly<{ sizePt: number; lines: readonly PlacedLine[] }>;
type Measure = (text: string, sizePt: number) => number;

const documentNames = { national_id: "DNI", passport: "Pasaporte", foreign_id: "CE" } as const;

// fitLabelLines rejects blank lines, so collapse them (multiline inputs allow them).
const singleBreaks = (text: string) => text.trim().replace(/\s*\n\s*/g, "\n");

function items(label: DispatchLabel): Item[] {
  const { recipient, destination } = label;
  const document = recipient.document ? `${documentNames[recipient.document.type]} ${recipient.document.number}` : null;
  const { department, province, district } = destination.location;
  const date = label.scheduledDate?.split("-").reverse().join("/");
  const footer = [label.courier, date].filter((part): part is string => Boolean(part)).join(" · ");
  const rows: (Item | null)[] = [
    { block: "sender", text: label.sender, scale: 1 },
    { block: "recipient", text: recipient.name, scale: 1.5 },
    { block: "recipient", text: `Cel. ${recipient.phone}`, scale: 1.1 },
    document ? { block: "recipient", text: document, scale: 1.1 } : null,
    label.method === "agency" ? { block: "destination", text: label.destination.agencyName, scale: 1.2 } : null,
    { block: "destination", text: singleBreaks(destination.address), scale: 1.1 },
    { block: "destination", text: `${district}, ${province}, ${department}`, scale: 1.1 },
    label.method === "home" && label.destination.reference ? { block: "destination", text: `Ref: ${singleBreaks(label.destination.reference)}`, scale: 1 } : null,
    footer ? { block: "footer", text: footer, scale: 1.1 } : null,
  ];
  return rows.filter((row): row is Item => row !== null);
}

/** Single layout used by both the preflight measurement and the render: wraps, then shrinks the font down to the minimum; never truncates. */
export function layoutDispatchLabel(
  label: DispatchLabel, profile: RenderProfile, measure: Measure, typography: DispatchLabelTypography = defaultDispatchLabelTypography,
): Result<DispatchLabelLayout, RenderError> {
  const margin = Math.ceil(profile.dpiX / 25.4);
  const width = profile.widthPx - 2 * margin;
  const gap = Math.ceil(profile.dpiY / 25.4);
  const overflow = err({ code: "LABEL_CONTENT_OVERFLOW" as const, message: "Dispatch label text does not fit on this paper" });
  if (width <= 0 || !(typography.stepPt > 0)) return overflow;
  const rows = items(label);
  for (let sizePt = typography.basePt; sizePt >= typography.minPt; sizePt -= typography.stepPt) {
    const lines: PlacedLine[] = [];
    let y = margin;
    let fits = true;
    rows.forEach((row, index) => {
      if (!fits) return;
      const itemPt = sizePt * row.scale;
      const wrapped = fitLabelLines(row.text, width, (text) => measure(text, itemPt), Number.POSITIVE_INFINITY, false);
      if (!wrapped) { fits = false; return; }
      if (index > 0 && rows[index - 1].block !== row.block) y += gap * 2;
      const lineHeight = Math.ceil(itemPt * profile.dpiY / 72 * 1.16);
      for (const text of wrapped) { y += lineHeight; lines.push({ text, y, sizePt: itemPt }); }
    });
    if (fits && y + margin <= profile.heightPx) return ok({ sizePt, lines });
  }
  return overflow;
}

async function measurer(profile: RenderProfile): Promise<Measure> {
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
