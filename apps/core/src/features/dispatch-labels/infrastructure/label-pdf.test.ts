import { expect, test } from "vitest";
import { createLabelPdf, labelGeometry, labelPageCount, labelSlot, pageSizePt } from "@core/src/features/dispatch-labels/infrastructure/label-pdf";
import type { DispatchLabelLayout } from "@shared/dispatch-label/layout";

const mm = (value: number) => value * 72 / 25.4;
const layout: DispatchLabelLayout = { sizePt: 12, lines: [{ text: "Fantastidog", y: 15, sizePt: 12 }, { text: "Ángel Peña — Av. Ñandú 123", y: 40, sizePt: 18 }] };

function text(pdf: Buffer) {
  return pdf.toString("latin1");
}
function pageBoxes(pdf: Buffer) {
  return [...text(pdf).matchAll(/\/Type \/Page\b(?!s)[^>]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gs)].map((match) => [Number(match[1]), Number(match[2])]);
}

test("label geometry is exactly 62 x 100 mm in points at 72 dpi", () => {
  expect(labelGeometry).toMatchObject({ dpiX: 72, dpiY: 72 });
  expect(labelGeometry.widthPx).toBeCloseTo(mm(62), 6);
  expect(labelGeometry.heightPx).toBeCloseTo(mm(100), 6);
  expect(pageSizePt("label_62x100")).toEqual([labelGeometry.widthPx, labelGeometry.heightPx]);
  expect(pageSizePt("a4")).toEqual([595.28, 841.89]);
});

test("a single label per page in the roll format", () => {
  expect(labelSlot("label_62x100", 0)).toEqual({ page: 0, x: 0, y: 0 });
  expect(labelSlot("label_62x100", 3)).toEqual({ page: 3, x: 0, y: 0 });
  expect([1, 2, 7].map((count) => labelPageCount("label_62x100", count))).toEqual([1, 2, 7]);
});

test("A4 holds a centered grid of 3 columns by 2 rows filled left to right then top to bottom", () => {
  const left = (595.28 - 3 * mm(62)) / 2;
  const top = (841.89 - 2 * mm(100)) / 2;
  expect(left).toBeCloseTo(mm(12), 0);
  expect(top).toBeCloseTo(mm(48.5), 0);
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => labelSlot("a4", index));
  expect(slots.map(({ page }) => page)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  expect(slots[0]).toMatchObject({ page: 0 });
  expect(slots[0].x).toBeCloseTo(left, 6);
  expect(slots[0].y).toBeCloseTo(top, 6);
  expect(slots[1].x).toBeCloseTo(left + mm(62));
  expect(slots[2].x).toBeCloseTo(left + 2 * mm(62));
  expect(slots[3].x).toBe(slots[0].x);
  expect(slots[3].y).toBeCloseTo(top + mm(100), 6);
  expect(slots[5].y).toBeCloseTo(top + mm(100));
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
    expect(text(result.data)).toContain("[3 3] 0 d");
    expect((text(result.data).match(/ re\n/g) ?? []).length).toBe(count);
  }
});

test("measurement uses the embedded Inter font, so wider text and sizes measure wider", () => {
  const { measure } = createLabelPdf("label_62x100");
  expect(measure("", 12)).toBe(0);
  expect(measure("Fantastidog", 12)).toBeGreaterThan(40);
  expect(measure("Fantastidog", 24)).toBeCloseTo(measure("Fantastidog", 12) * 2, 3);
  expect(measure("WWWW", 12)).toBeGreaterThan(measure("iiii", 12));
});

test("a document without labels is rejected as a render error", async () => {
  const result = await createLabelPdf("a4").render([]);
  expect(result).toEqual({ success: false, error: { code: "PDF_RENDER_FAILED", message: "Nothing to render" } });
});
