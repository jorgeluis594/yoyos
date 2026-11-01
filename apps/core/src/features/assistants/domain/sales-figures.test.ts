import { describe, expect, test } from "vitest";
import { averageCents, centsOf, compareAverages, compareFigure, counted, roundHalfUp, sharePercent } from "@core/src/features/assistants/domain/sales-figures";

describe("sales figures", () => {
  test("rounds the average ticket half up to the cent", () => {
    expect(averageCents(10_000, 3)).toBe(3_333);
    expect(averageCents(10_001, 2)).toBe(5_001);
    expect(averageCents(1, 2)).toBe(1);
    expect(averageCents(0, 0)).toBe(0);
    expect(centsOf({ amount: 640.1 })).toBe(64_010);
    expect(centsOf({ amount: 0.29 })).toBe(29);
  });

  test("shows a share below 0.5% as menos de 1% and never adjusts shares to 100", () => {
    expect(sharePercent(1000, 3000)).toEqual({ kind: "percent", value: 33 });
    expect([1000, 1000, 1000].map((part) => sharePercent(part, 3000))).toEqual(Array(3).fill({ kind: "percent", value: 33 }));
    expect(sharePercent(49, 10_000)).toEqual({ kind: "under_one" });
    expect(sharePercent(50, 10_000)).toEqual({ kind: "percent", value: 1 });
    expect(sharePercent(1, 2)).toEqual({ kind: "percent", value: 50 });
  });

  test("states a comparison with both figures, the direction in words and a percent of the previous figure", () => {
    expect(compareFigure(68_000, 60_000)).toEqual({ kind: "more", difference: 8_000, percent: 13 });
    expect(compareFigure(17_000, 20_000)).toEqual({ kind: "less", difference: 3_000, percent: 15 });
    expect(compareFigure(100, 100)).toEqual({ kind: "same" });
  });

  test("rounds half up on the magnitude for negative comparisons", () => {
    expect(compareFigure(17_100, 20_000)).toMatchObject({ kind: "less", percent: 15 });
    expect(compareFigure(22_900, 20_000)).toMatchObject({ kind: "more", percent: 15 });
    expect(roundHalfUp(-29, 2)).toBe(-15);
    expect(roundHalfUp(29, 2)).toBe(15);
    expect(roundHalfUp(-1, 3)).toBe(0);
  });

  test("compares the two rounded average tickets so the shown figures and the difference reconcile", () => {
    // 10.01 / 3 = 3.3367 → 3.34 and 20.00 / 3 = 6.67: the difference is 6.67 − 3.34 = 3.33, not the 3.3 of the unrounded averages.
    expect(compareAverages({ totalCents: 2_000, orders: 3 }, { totalCents: 1_001, orders: 3 })).toEqual({ kind: "more", difference: 667 - 334, percent: 100 });
    expect(compareAverages({ totalCents: 600, orders: 3 }, { totalCents: 600, orders: 3 })).toEqual({ kind: "same" });
  });

  test("shows menos de 1% for a non-zero difference that rounds to 0 and no percent when the previous figure is 0", () => {
    expect(compareFigure(60_100, 60_000)).toEqual({ kind: "more", difference: 100, percent: "under_one" });
    expect(compareFigure(38_000, 0)).toEqual({ kind: "more", difference: 38_000, percent: null });
  });

  test("uses the singular for one in every counter", () => {
    expect(counted(1, "pedido", "pedidos")).toBe("1 pedido");
    expect(counted(0, "pedido", "pedidos")).toBe("0 pedidos");
    expect(counted(2, "unidad", "unidades")).toBe("2 unidades");
  });
});
