import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { err, ok } from "@shared/functional";
import type { DispatchLabelSize } from "@shared/dispatch-label/types";
import { defaultDispatchLabelTypography, type DispatchLabelGeometry, type DispatchLabelTypography } from "@shared/dispatch-label/layout";
import type { LabelPdf } from "@core/src/features/dispatch-labels/application/create-dispatch-labels";

const pointsPerMm = 72 / 25.4;
const fontPath = (file: string) => fileURLToPath(new URL(`../../../../assets/fonts/${file}`, import.meta.url));
const a4: readonly [number, number] = [595.28, 841.89];
const columns = 2;
const rows = 3;
const cellWidth = 105 * pointsPerMm;
const cellHeight = 99 * pointsPerMm;

/** Vector geometry of one roll label: 62 x 100 mm in points (dpi 72) with 2 mm padding, the input of `layoutDispatchLabel`. */
export const labelGeometry: DispatchLabelGeometry = { widthPx: 62 * pointsPerMm, heightPx: 100 * pointsPerMm, dpiX: 72, dpiY: 72, paddingMm: 2 };
/** One A4 cell: 105 x 99 mm; 6 mm padding clears the unprintable margin of office printers. */
const a4CellGeometry: DispatchLabelGeometry = { widthPx: cellWidth, heightPx: cellHeight, dpiX: 72, dpiY: 72, paddingMm: 6 };

export function labelGeometryOf(size: DispatchLabelSize): DispatchLabelGeometry {
  return size === "a4" ? a4CellGeometry : labelGeometry;
}

export function labelTypography(size: DispatchLabelSize): DispatchLabelTypography {
  return size === "a4" ? { ...defaultDispatchLabelTypography, basePt: 16 } : defaultDispatchLabelTypography;
}

export function pageSizePt(size: DispatchLabelSize): readonly [number, number] {
  return size === "a4" ? a4 : [labelGeometry.widthPx, labelGeometry.heightPx];
}

const perPage = (size: DispatchLabelSize) => size === "a4" ? columns * rows : 1;

export function labelPageCount(size: DispatchLabelSize, labels: number) {
  return Math.ceil(labels / perPage(size));
}

/** Top-left corner of the label with this index: one per roll page, or a 2 x 3 grid of cells that fills the A4 sheet, left to right, then top to bottom. */
export function labelSlot(size: DispatchLabelSize, index: number) {
  const page = Math.floor(index / perPage(size));
  if (size !== "a4") return { page, x: 0, y: 0 };
  const position = index % perPage(size);
  return { page, x: (position % columns) * cellWidth, y: Math.floor(position / columns) * cellHeight };
}

/** Dashed cut lines on the inner edges of a used cell; page edges need no cut. */
function cutLines(document: PDFKit.PDFDocument, x: number, y: number) {
  const edges: [number, number, number, number][] = [];
  if (x > 0) edges.push([x, y, x, y + cellHeight]);
  if (x + cellWidth < a4[0] - 1) edges.push([x + cellWidth, y, x + cellWidth, y + cellHeight]);
  if (y > 0) edges.push([x, y, x + cellWidth, y]);
  if (y + cellHeight < a4[1] - 1) edges.push([x, y + cellHeight, x + cellWidth, y + cellHeight]);
  document.save().lineWidth(0.5).strokeColor("#000000").dash(3, { space: 3 });
  for (const [x1, y1, x2, y2] of edges) document.moveTo(x1, y1).lineTo(x2, y2).stroke();
  document.undash().restore();
}

function collect(document: PDFKit.PDFDocument) {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
}

/** One document per request: it measures and draws with the same registered font, so the fit check matches the output. */
export function createLabelPdf(size: DispatchLabelSize, options: Readonly<{ compress?: boolean }> = {}): LabelPdf {
  const [pageWidth, pageHeight] = pageSizePt(size);
  const document = new PDFDocument({ autoFirstPage: false, margin: 0, bufferPages: true, compress: options.compress ?? true, info: { Title: "Rótulos de despacho" } });
  document.registerFont("regular", fontPath("InterVariable.ttf"));
  // pdfkit cannot select a weight of the variable font, so bold is the static file.
  document.registerFont("bold", fontPath("Inter-Bold.ttf"));
  return {
    geometry: labelGeometryOf(size),
    typography: labelTypography(size),
    measure: (text, sizePt, weight) => document.font(weight).fontSize(sizePt).widthOfString(text),
    render: async (layouts) => {
      if (!layouts.length) return err({ code: "PDF_RENDER_FAILED", message: "Nothing to render" });
      try {
        const output = collect(document);
        for (let page = 0; page < labelPageCount(size, layouts.length); page++) document.addPage({ size: [pageWidth, pageHeight], margin: 0 });
        layouts.forEach((layout, index) => {
          const { page, x, y } = labelSlot(size, index);
          document.switchToPage(page);
          if (size === "a4") cutLines(document, x, y);
          document.fillColor("#000000").strokeColor("#000000");
          for (const rule of layout.rules) document.lineWidth(rule.thickness).moveTo(x + rule.x1, y + rule.y).lineTo(x + rule.x2, y + rule.y).stroke();
          for (const line of layout.lines) document.font(line.weight).fontSize(line.sizePt).text(line.text, x + line.x, y + line.y, { baseline: "alphabetic", lineBreak: false });
        });
        document.flushPages();
        document.end();
        return ok(await output);
      } catch {
        return err({ code: "PDF_RENDER_FAILED", message: "Could not render the dispatch labels" });
      }
    },
  };
}
