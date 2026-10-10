import { productMargin } from "@mobile/features/products/domain/product-margin";

const pen = (amount: number) => ({ amount, currency: "PEN" as const });

test("computes profit in cents and margin over the sale price", () => {
  expect(productMargin(pen(59.9), pen(32))).toEqual({ success: true, data: { profit: pen(27.9), percent: 46.6 } });
  expect(productMargin(pen(0.3), pen(0.1))).toEqual({ success: true, data: { profit: pen(0.2), percent: 66.7 } });
});

test("reports a loss as negative profit and margin", () => {
  expect(productMargin(pen(20), pen(25))).toEqual({ success: true, data: { profit: pen(-5), percent: -25 } });
});

test("rejects a margin without a positive sale price or with mixed currencies", () => {
  expect(productMargin(pen(0), pen(10))).toMatchObject({ success: false, error: { code: "DIVISION_BY_ZERO" } });
  expect(productMargin(pen(10), { amount: 5, currency: "USD" })).toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
});
