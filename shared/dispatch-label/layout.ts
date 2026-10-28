import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DispatchLabel } from "@shared/dispatch-label/types";
import { fitLabelWords } from "@shared/dispatch-label/label-text";

/** Page geometry in pixels at the given resolution; use dpi 72 and points for vector output (1 mm = 72 / 25.4 pt). `paddingMm` is the blank inner border. */
export type DispatchLabelGeometry = Readonly<{ widthPx: number; heightPx: number; dpiX: number; dpiY: number; paddingMm: number }>;
export type DispatchLabelOverflowError = Readonly<{ code: "LABEL_CONTENT_OVERFLOW"; message: string }>;
export type DispatchLabelTypography = Readonly<{ basePt: number; minPt: number; stepPt: number }>;
// shortcut: provisional sizes; the physical pilot test sets the real minimum.
export const defaultDispatchLabelTypography: DispatchLabelTypography = { basePt: 12, minPt: 7, stepPt: 0.5 };

export type DispatchLabelWeight = "regular" | "bold";
/** One run of text drawn at (x, baseline y); a printed line may hold several runs of different weight. */
type PlacedText = Readonly<{ text: string; x: number; y: number; sizePt: number; weight: DispatchLabelWeight }>;
type PlacedRule = Readonly<{ y: number; x1: number; x2: number; thickness: number }>;
/** Black only (thermal printers): renderers draw every run and rule as given, without re-deriving positions. */
export type DispatchLabelLayout = Readonly<{ sizePt: number; lines: readonly PlacedText[]; rules: readonly PlacedRule[] }>;
/** Bold is wider than regular, so the measure takes the weight. */
export type MeasureText = (text: string, sizePt: number, weight: DispatchLabelWeight) => number;

type Part = Readonly<{ text: string; weight: DispatchLabelWeight }>;
/** Parts share a line joined by " · " while they fit, and break at the separator otherwise. */
type Row = Readonly<{ parts: readonly Part[]; scale: number }>;
type Section = Readonly<{ heading: string | null; rows: readonly Row[] }>;

const separator = " · ";
const headingScale = 0.8;
const ruleThicknessPt = 0.75;
const documentNames = { national_id: "DNI", passport: "Pasaporte", foreign_id: "CE" } as const;

// fitLabelWords rejects blank lines, so collapse them (multiline inputs allow them).
const singleBreaks = (text: string) => text.trim().replace(/\s*\n\s*/g, "\n");
const regular = (text: string): Part => ({ text, weight: "regular" });
const bold = (text: string): Part => ({ text, weight: "bold" });
const row = (scale: number, ...parts: (Part | null)[]): Row => ({ scale, parts: parts.filter((part): part is Part => part !== null) });

function sections(label: DispatchLabel): { body: Section[]; footer: Row[] } {
  const { recipient, destination, sender } = label;
  const senderPhone = sender.phone?.trim();
  const document = recipient.document ? `${documentNames[recipient.document.type]} ${recipient.document.number}` : null;
  const { department, province, district } = destination.location;
  const date = label.scheduledDate?.split("-").reverse().join("/");
  const place = label.method === "agency"
    ? { heading: "RECOJO EN AGENCIA", rows: [row(1.2, bold(label.destination.agencyName))] }
    : { heading: "ENTREGA A DOMICILIO", rows: [] };
  return {
    body: [
      { heading: "REMITENTE", rows: [row(1, regular(sender.name), senderPhone ? regular(`Cel. ${senderPhone}`) : null)] },
      { heading: "DESTINATARIO", rows: [row(1.5, bold(recipient.name)), row(1.1, regular(`Cel. ${recipient.phone}`), document ? regular(document) : null)] },
      { heading: place.heading, rows: [
        ...place.rows,
        row(1.1, regular(singleBreaks(destination.address))),
        // Couriers sort by district, so it goes first and stands out.
        row(1.1, ...[district, province, department].map((name) => bold(name.toUpperCase()))),
        label.method === "home" && label.destination.reference ? row(1, regular(`Ref: ${singleBreaks(label.destination.reference)}`)) : null,
      ].filter((item): item is Row => item !== null) },
    ],
    footer: [
      ...(label.courier ? [row(1.1, regular(`Courier: ${label.courier}`))] : []),
      row(1, bold(`Pedido #${label.orderNumber}`), date ? regular(date) : null),
    ],
  };
}

type Run = Readonly<{ text: string; x: number; weight: DispatchLabelWeight }>;

/** Lines of runs (x relative to the text column) for one row, or null when a word cannot fit at all. */
function wrapRow(parts: readonly Part[], width: number, measure: (text: string, weight: DispatchLabelWeight) => number): Run[][] | null {
  const lines: Run[][] = [];
  let line: Run[] = [];
  let x = 0;
  for (const part of parts) {
    const partWidth = measure(part.text, part.weight);
    const gap = line.length ? measure(separator, "regular") : 0;
    if (!part.text.includes("\n") && x + gap + partWidth <= width) {
      if (line.length) line.push({ text: separator, x, weight: "regular" });
      line.push({ text: part.text, x: x + gap, weight: part.weight });
      x += gap + partWidth;
      continue;
    }
    if (line.length) lines.push(line);
    const wrapped = fitLabelWords(part.text, width, (text) => measure(text, part.weight));
    if (!wrapped) return null;
    lines.push(...wrapped.slice(0, -1).map((text) => [{ text, x: 0, weight: part.weight }]));
    const last = wrapped.at(-1) ?? "";
    line = [{ text: last, x: 0, weight: part.weight }];
    x = measure(last, part.weight);
  }
  if (line.length) lines.push(line);
  return lines;
}

type Block = Readonly<{ lines: { runs: Run[]; sizePt: number; advance: number }[]; height: number }>;

function block(rows: readonly Row[], heading: string | null, sizePt: number, width: number, measure: MeasureText, pxPerPt: number): Block | null {
  const lineHeight = (pt: number) => Math.ceil(pt * pxPerPt * 1.16);
  const headed = heading ? [{ scale: headingScale, parts: [bold(heading)] }, ...rows] : rows;
  const lines: Block["lines"] = [];
  for (const item of headed) {
    const itemPt = sizePt * item.scale;
    const wrapped = wrapRow(item.parts, width, (text, weight) => measure(text, itemPt, weight));
    if (!wrapped) return null;
    for (const runs of wrapped) lines.push({ runs, sizePt: itemPt, advance: lineHeight(itemPt) });
  }
  return { lines, height: lines.reduce((total, line) => total + line.advance, 0) };
}

/** Single layout used by every platform: sections under headings split by rules, footer pinned to the bottom; wraps at word boundaries, then shrinks the font down to the minimum; never truncates. */
export function layoutDispatchLabel(
  label: DispatchLabel, geometry: DispatchLabelGeometry, measure: MeasureText, typography: DispatchLabelTypography = defaultDispatchLabelTypography,
): Result<DispatchLabelLayout, DispatchLabelOverflowError> {
  const paddingX = geometry.paddingMm * geometry.dpiX / 25.4;
  const paddingY = geometry.paddingMm * geometry.dpiY / 25.4;
  const width = geometry.widthPx - 2 * paddingX;
  const gap = geometry.dpiY / 25.4 * 1.2;
  const pxPerPt = geometry.dpiY / 72;
  const thickness = ruleThicknessPt * pxPerPt;
  const overflow = err({ code: "LABEL_CONTENT_OVERFLOW" as const, message: "Dispatch label text does not fit on this paper" });
  if (width <= 0 || !(typography.stepPt > 0)) return overflow;
  const { body, footer } = sections(label);
  for (let sizePt = typography.basePt; sizePt >= typography.minPt; sizePt -= typography.stepPt) {
    const blocks = body.map((section) => block(section.rows, section.heading, sizePt, width, measure, pxPerPt));
    const footerBlock = block(footer, null, sizePt, width, measure, pxPerPt);
    if (!footerBlock || blocks.some((item) => !item)) continue;
    // Below the last baseline, room for descenders before the next rule or the bottom edge.
    const descent = (item: Block) => Math.ceil((item.lines.at(-1)?.sizePt ?? sizePt) * pxPerPt * 0.25);
    const lines: PlacedText[] = [];
    const rules: PlacedRule[] = [];
    const place = (item: Block, top: number) => {
      let y = top;
      for (const line of item.lines) {
        y += line.advance;
        lines.push(...line.runs.map((run) => ({ text: run.text, x: paddingX + run.x, y, sizePt: line.sizePt, weight: run.weight })));
      }
      return y + descent(item);
    };
    const rule = (y: number) => rules.push({ y, x1: paddingX, x2: geometry.widthPx - paddingX, thickness });
    let y = paddingY;
    (blocks as Block[]).forEach((item, index) => {
      if (index > 0) { y += gap; rule(y); y += gap; }
      y = place(item, y);
    });
    const footerTop = geometry.heightPx - paddingY - descent(footerBlock) - footerBlock.height;
    if (y + 2 * gap > footerTop) continue;
    rule(footerTop - gap);
    place(footerBlock, footerTop);
    return ok({ sizePt, lines, rules });
  }
  return overflow;
}
