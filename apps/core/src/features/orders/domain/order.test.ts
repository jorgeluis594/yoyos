import { describe, expect, test } from "vitest";
import { buildOrder, type BuildOrderInput, type CompanyId, type ContactId, type OrderId, type OrderItemId, type UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const item = (n: number, quantity: number, amount: number, currency = "PEN") => ({
  id: id(n + 10) as OrderItemId, variantId: id(n + 100) as VariantId, productName: `Product ${n}`,
  variantAttributes: { Size: "M" }, sku: null, quantity, unitPrice: { amount, currency },
});
const base = (): BuildOrderInput => ({ id: id(1) as OrderId, companyId: id(2) as CompanyId, sellerId: "seller" as UserId,
  customer: { kind: "general_public" }, completedAt: new Date("2026-09-27T12:00:00Z"), items: [item(1, 3, 0.1), item(2, 2, 0.2)] });

describe("buildOrder", () => {
  test("calculates exact cents and keeps supplied identity and timestamp", () => {
    const result = buildOrder(base());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ id: id(1), companyId: id(2), sellerId: "seller", customer: { kind: "general_public" },
      paymentMethod: "digital_wallet", total: { amount: 0.7, currency: "PEN" } });
    expect(result.data.completedAt).toEqual(new Date("2026-09-27T12:00:00Z"));
    expect(result.data.items.map((line) => line.subtotal.amount)).toEqual([0.3, 0.4]);
  });

  test("copies unnamed contact and attributes", () => {
    const input = { ...base(), customer: { kind: "contact" as const, contactId: id(3) as ContactId, name: null, phone: "+51999999999" } };
    const result = buildOrder(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    (input.items[0].variantAttributes as { Size: string }).Size = "XL";
    expect(result.data.customer).toEqual({ kind: "contact", contactId: id(3), name: null, phone: "+51999999999" });
    expect(result.data.items[0].variantAttributes).toEqual({ Size: "M" });
  });

  test.each([
    ["empty", []], ["duplicate", [item(1, 1, 1), item(1, 2, 1)]],
    ["zero", [item(1, 0, 1)]], ["negative", [item(1, -1, 1)]], ["fraction", [item(1, 1.5, 1)]],
    ["infinite", [item(1, Infinity, 1)]], ["unsafe", [item(1, Number.MAX_SAFE_INTEGER + 1, 1)]],
    ["zero price", [item(1, 1, 0)]], ["negative price", [item(1, 1, -1)]], ["non-finite price", [item(1, 1, Infinity)]],
    ["fractional cent", [item(1, 1, 0.001)]],
    ["price overflow", [item(1, 1, 1_000_000_000)]], ["subtotal overflow", [item(1, 100_001, 999_999_999.99)]],
  ])("rejects %s", (_name, items) => {
    expect(buildOrder({ ...base(), items: items as BuildOrderInput["items"] })).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  });

  test("rejects currency mismatch", () => {
    expect(buildOrder({ ...base(), items: [item(1, 1, 1), item(2, 1, 1, "USD")] })).toMatchObject({ success: false, error: { code: "CURRENCY_MISMATCH" } });
  });

  test("accepts cent price and rejects total overflow across valid subtotals", () => {
    expect(buildOrder({ ...base(), items: [item(1, 1, 0.29)] })).toMatchObject({ success: true, data: { total: { amount: 0.29 } } });
    expect(buildOrder({ ...base(), items: [item(1, 1, 999_999_999.99)] })).toMatchObject({ success: true, data: { total: { amount: 999_999_999.99 } } });
    const large = 999_999_999.99;
    expect(buildOrder({ ...base(), items: [item(1, 10000, large), item(2, 1, large)] })).toMatchObject({ success: false, error: { code: "INVALID_ORDER" } });
  });
});
