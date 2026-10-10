import { productMargin } from "@mobile/features/products/domain/product-margin";

const pen = (amount: number) => ({ amount, currency: "PEN" as const });

test("computes profit in cents and margin over the sale price", () => {
  expect(productMargin(pen(59.9), pen(32))).toEqual({ success: true, data: { profit: pen(27.9), percent: 46.6 } });
  expect(productMargin(pen(0.3), pen(0.1))).toEqual({ success: true, data: { profit: pen(0.2), percent: 66.7 } });
});

test("reports a loss as negative profit and margin", () => {
  expect(productMargin(pen(20), pen(25))).toEqual({ success: true, data: { profit: pen(-5), percent: -25 } });
});

test("rounds gains and losses symmetrically and never reports negative zero", () => {
  expect(productMargin(pen(2000), pen(1999))).toMatchObject({ data: { percent: 0.1 } });
  expect(productMargin(pen(2000), pen(2001))).toMatchObject({ data: { percent: -0.1 } });
  const tinyLoss = productMargin(pen(1000), pen(1000.4));
  expect(tinyLoss.success && Object.is(tinyLoss.data.percent, 0)).toBe(true);
});

test("rejects a margin without a positive sale price or with mixed currencies", () => {
  expect(productMargin(pen(0), pen(10))).toMatchObject({ success: false, error: { code: "INVALID_AMOUNT" } });
  expect(productMargin(pen(10), { amount: 5, currency: "USD" })).toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
});
