import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DispatchLabelSize } from "@shared/contracts/dispatch-labels";
import type { DispatchLabelGeometry, DispatchLabelLayout, MeasureText } from "@shared/dispatch-label/layout";

export type LabelPdfError = Readonly<{ code: "PDF_RENDER_FAILED"; message: string }>;
export type LabelPdf = Readonly<{
  geometry: DispatchLabelGeometry;
  /** Width in points of the text in Inter, the same font `render` draws with. */
  measure: MeasureText;
  render: (layouts: readonly DispatchLabelLayout[]) => Promise<Result<Buffer, LabelPdfError>>;
}>;

const pointsPerMm = 72 / 25.4;
const fontPath = fileURLToPath(new URL("../../../../assets/fonts/InterVariable.ttf", import.meta.url));
const a4: readonly [number, number] = [595.28, 841.89];
const columns = 3;
const rows = 2;

/** Vector geometry of one label: 62 x 100 mm in points (dpi 72), the input of `layoutDispatchLabel`. */
export const labelGeometry: DispatchLabelGeometry = { widthPx: 62 * pointsPerMm, heightPx: 100 * pointsPerMm, dpiX: 72, dpiY: 72 };
// Same margin the shared layout leaves inside the label (1 mm rounded up at the given dpi).
const labelMargin = Math.ceil(labelGeometry.dpiX / 25.4);

export function pageSizePt(size: DispatchLabelSize): readonly [number, number] {
  return size === "a4" ? a4 : [labelGeometry.widthPx, labelGeometry.heightPx];
}

const perPage = (size: DispatchLabelSize) => size === "a4" ? columns * rows : 1;

export function labelPageCount(size: DispatchLabelSize, labels: number) {
  return Math.ceil(labels / perPage(size));
}

/** Top-left corner of the label with this index: one per roll page, or a centered 3 x 2 grid filled left to right, then top to bottom. */
export function labelSlot(size: DispatchLabelSize, index: number) {
  const page = Math.floor(index / perPage(size));
  if (size !== "a4") return { page, x: 0, y: 0 };
  const position = index % perPage(size);
  const left = (a4[0] - columns * labelGeometry.widthPx) / 2;
  const top = (a4[1] - rows * labelGeometry.heightPx) / 2;
  return { page, x: left + (position % columns) * labelGeometry.widthPx, y: top + Math.floor(position / columns) * labelGeometry.heightPx };
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
  document.registerFont("Inter", fontPath);
  document.font("Inter");
  return {
    geometry: labelGeometry,
    measure: (text, sizePt) => document.fontSize(sizePt).widthOfString(text),
    render: async (layouts) => {
      if (!layouts.length) return err({ code: "PDF_RENDER_FAILED", message: "Nothing to render" });
      try {
        const output = collect(document);
        for (let page = 0; page < labelPageCount(size, layouts.length); page++) document.addPage({ size: [pageWidth, pageHeight], margin: 0 });
        layouts.forEach((layout, index) => {
          const { page, x, y } = labelSlot(size, index);
          document.switchToPage(page);
          if (size === "a4") document.save().lineWidth(0.5).strokeColor("#999999").dash(3, { space: 3 })
            .rect(x, y, labelGeometry.widthPx, labelGeometry.heightPx).stroke().undash().restore();
          document.fillColor("#000000");
          for (const line of layout.lines) document.fontSize(line.sizePt).text(line.text, x + labelMargin, y + line.y, { baseline: "alphabetic", lineBreak: false });
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
