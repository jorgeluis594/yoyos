import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DispatchLabel } from "@shared/dispatch-label/types";
import { fitLabelLines } from "@shared/dispatch-label/label-text";

/** Page geometry in pixels at the given resolution; use dpi 72 and points for vector output (1 mm = 72 / 25.4 pt). */
export type DispatchLabelGeometry = Readonly<{ widthPx: number; heightPx: number; dpiX: number; dpiY: number }>;
export type DispatchLabelOverflowError = Readonly<{ code: "LABEL_CONTENT_OVERFLOW"; message: string }>;
export type DispatchLabelTypography = Readonly<{ basePt: number; minPt: number; stepPt: number }>;
// shortcut: provisional sizes; the physical pilot test sets the real minimum.
export const defaultDispatchLabelTypography: DispatchLabelTypography = { basePt: 12, minPt: 7, stepPt: 0.5 };

type Block = "sender" | "recipient" | "destination" | "footer";
type Item = Readonly<{ block: Block; text: string; scale: number }>;
type PlacedLine = Readonly<{ text: string; y: number; sizePt: number }>;
export type DispatchLabelLayout = Readonly<{ sizePt: number; lines: readonly PlacedLine[] }>;
export type MeasureText = (text: string, sizePt: number) => number;

const documentNames = { national_id: "DNI", passport: "Pasaporte", foreign_id: "CE" } as const;

// fitLabelLines rejects blank lines, so collapse them (multiline inputs allow them).
const singleBreaks = (text: string) => text.trim().replace(/\s*\n\s*/g, "\n");

function items(label: DispatchLabel): Item[] {
  const { recipient, destination, sender } = label;
  const document = recipient.document ? `${documentNames[recipient.document.type]} ${recipient.document.number}` : null;
  const { department, province, district } = destination.location;
  const date = label.scheduledDate?.split("-").reverse().join("/");
  const orderLine = [`Pedido #${label.orderNumber}`, date].filter(Boolean).join(" · ");
  const rows: (Item | null)[] = [
    { block: "sender", text: sender.name, scale: 1 },
    sender.phone?.trim() ? { block: "sender", text: `Cel. ${sender.phone.trim()}`, scale: 1 } : null,
    { block: "recipient", text: recipient.name, scale: 1.5 },
    { block: "recipient", text: `Cel. ${recipient.phone}`, scale: 1.1 },
    document ? { block: "recipient", text: document, scale: 1.1 } : null,
    label.method === "agency" ? { block: "destination", text: label.destination.agencyName, scale: 1.2 } : null,
    { block: "destination", text: singleBreaks(destination.address), scale: 1.1 },
    { block: "destination", text: `${district}, ${province}, ${department}`, scale: 1.1 },
    label.method === "home" && label.destination.reference ? { block: "destination", text: `Ref: ${singleBreaks(label.destination.reference)}`, scale: 1 } : null,
    label.courier ? { block: "footer", text: label.courier, scale: 1.1 } : null,
    { block: "footer", text: orderLine, scale: 1 },
  ];
  return rows.filter((row): row is Item => row !== null);
}

/** Single layout used by every platform: wraps, then shrinks the font down to the minimum; never truncates. */
export function layoutDispatchLabel(
  label: DispatchLabel, geometry: DispatchLabelGeometry, measure: MeasureText, typography: DispatchLabelTypography = defaultDispatchLabelTypography,
): Result<DispatchLabelLayout, DispatchLabelOverflowError> {
  const margin = Math.ceil(geometry.dpiX / 25.4);
  const width = geometry.widthPx - 2 * margin;
  const gap = Math.ceil(geometry.dpiY / 25.4);
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
      const lineHeight = Math.ceil(itemPt * geometry.dpiY / 72 * 1.16);
      for (const text of wrapped) { y += lineHeight; lines.push({ text, y, sizePt: itemPt }); }
    });
    if (fits && y + margin <= geometry.heightPx) return ok({ sizePt, lines });
  }
  return overflow;
}
