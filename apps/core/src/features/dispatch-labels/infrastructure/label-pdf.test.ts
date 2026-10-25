import { expect, test } from "vitest";
import { createLabelPdf, labelGeometry, labelGeometryOf, labelPageCount, labelSlot, labelTypography, pageSizePt } from "@core/src/features/dispatch-labels/infrastructure/label-pdf";
import type { DispatchLabelLayout } from "@shared/dispatch-label/layout";

const mm = (value: number) => value * 72 / 25.4;
const layout: DispatchLabelLayout = { sizePt: 12, lines: [
  { text: "Fantastidog", x: 6, y: 15, sizePt: 12, weight: "regular" }, { text: "Ángel Peña — Av. Ñandú 123", x: 6, y: 40, sizePt: 18, weight: "bold" },
], rules: [{ y: 25, x1: 6, x2: 170, thickness: 0.75 }] };

function text(pdf: Buffer) {
  return pdf.toString("latin1");
}
function pageBoxes(pdf: Buffer) {
  return [...text(pdf).matchAll(/\/Type \/Page\b(?!s)[^>]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gs)].map((match) => [Number(match[1]), Number(match[2])]);
}

test("label geometry is exactly 62 x 100 mm in points at 72 dpi with 2 mm padding", () => {
  expect(labelGeometry).toMatchObject({ dpiX: 72, dpiY: 72, paddingMm: 2 });
  expect(labelGeometry.widthPx).toBeCloseTo(mm(62), 6);
  expect(labelGeometry.heightPx).toBeCloseTo(mm(100), 6);
  expect(pageSizePt("label_62x100")).toEqual([labelGeometry.widthPx, labelGeometry.heightPx]);
  expect(pageSizePt("a4")).toEqual([595.28, 841.89]);
});

test("an A4 cell is 105 x 99 mm with 6 mm padding and starts at 16 pt; the roll starts at 12 pt", () => {
  const cell = labelGeometryOf("a4");
  expect(cell.widthPx).toBeCloseTo(mm(105), 6);
  expect(cell.heightPx).toBeCloseTo(mm(99), 6);
  expect(cell.paddingMm).toBe(6);
  expect(labelGeometryOf("label_62x100")).toBe(labelGeometry);
  expect(labelTypography("a4")).toEqual({ basePt: 16, minPt: 7, stepPt: 0.5 });
  expect(labelTypography("label_62x100")).toEqual({ basePt: 12, minPt: 7, stepPt: 0.5 });
});

test("a single label per page in the roll format", () => {
  expect(labelSlot("label_62x100", 0)).toEqual({ page: 0, x: 0, y: 0 });
  expect(labelSlot("label_62x100", 3)).toEqual({ page: 3, x: 0, y: 0 });
  expect([1, 2, 7].map((count) => labelPageCount("label_62x100", count))).toEqual([1, 2, 7]);
});

test("A4 holds a 2 x 3 grid of cells that fills the sheet, left to right then top to bottom", () => {
  const slots = [0, 1, 2, 3, 4, 5, 6].map((index) => labelSlot("a4", index));
  expect(slots.map(({ page }) => page)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  expect(slots[0]).toEqual({ page: 0, x: 0, y: 0 });
  expect(slots[1].x).toBeCloseTo(mm(105));
  expect(slots[2]).toMatchObject({ x: 0 });
  expect(slots[2].y).toBeCloseTo(mm(99));
  expect(slots[5].x).toBeCloseTo(mm(105));
  expect(slots[5].y).toBeCloseTo(2 * mm(99));
  expect(slots[6]).toEqual({ ...slots[0], page: 1 });
  expect([1, 6, 7].map((count) => labelPageCount("a4", count))).toEqual([1, 1, 2]);
});

test("the roll PDF has one 62 x 100 mm page per label and is returned as base64", async () => {
  const pdf = createLabelPdf("label_62x100");
  const result = await pdf.render([layout, layout, layout]);
  if (!result.success) throw new Error("render failed");
  expect(result.data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const boxes = pageBoxes(result.data);
  expect(boxes).toHaveLength(3);
  for (const [width, height] of boxes) {
    expect(width).toBeCloseTo(mm(62), 1);
    expect(height).toBeCloseTo(mm(100), 1);
  }
  expect(Buffer.from(result.data.toString("base64"), "base64").equals(result.data)).toBe(true);
});

test("A4 pages are 595.28 x 841.89 pt and a partial last sheet is kept", async () => {
  for (const [count, pages] of [[1, 1], [6, 1], [7, 2]] as const) {
    const result = await createLabelPdf("a4", { compress: false }).render(Array.from({ length: count }, () => layout));
    if (!result.success) throw new Error("render failed");
    const boxes = pageBoxes(result.data);
    expect(boxes).toHaveLength(pages);
    for (const [width, height] of boxes) {
      expect(width).toBeCloseTo(595.28, 1);
      expect(height).toBeCloseTo(841.89, 1);
    }
  }
});

test("dashed cut lines are drawn only on inner edges of used cells", async () => {
  const dashedSegments = async (count: number) => {
    const result = await createLabelPdf("a4", { compress: false }).render(Array.from({ length: count }, () => layout));
    if (!result.success) throw new Error("render failed");
    return text(result.data).split("[3 3] 0 d").slice(1).reduce((total, chunk) => total + (chunk.split("[] 0 d")[0].match(/ m\n/g) ?? []).length, 0);
  };
  // Corner cells have two inner edges and middle-row cells three; page edges get none.
  expect(await dashedSegments(1)).toBe(2);
  expect(await dashedSegments(6)).toBe(2 + 2 + 3 + 3 + 2 + 2);
});

test("rules and bold runs are drawn: two fonts embedded and a line stroked", async () => {
  const result = await createLabelPdf("label_62x100", { compress: false }).render([layout]);
  if (!result.success) throw new Error("render failed");
  expect(text(result.data).match(/\/FontFile2/g)).toHaveLength(2);
  expect(text(result.data)).toMatch(/0\.75 w/);
});

test("measurement uses the embedded Inter fonts, so wider text, sizes and bold measure wider", () => {
  const { measure } = createLabelPdf("label_62x100");
  expect(measure("", 12, "regular")).toBe(0);
  expect(measure("Fantastidog", 12, "regular")).toBeGreaterThan(40);
  expect(measure("Fantastidog", 24, "regular")).toBeCloseTo(measure("Fantastidog", 12, "regular") * 2, 3);
  expect(measure("WWWW", 12, "regular")).toBeGreaterThan(measure("iiii", 12, "regular"));
  expect(measure("Fantastidog", 12, "bold")).toBeGreaterThan(measure("Fantastidog", 12, "regular"));
});

test("a document without labels is rejected as a render error", async () => {
  const result = await createLabelPdf("a4").render([]);
  expect(result).toEqual({ success: false, error: { code: "PDF_RENDER_FAILED", message: "Nothing to render" } });
});
