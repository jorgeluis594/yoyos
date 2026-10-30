import { expect, test } from "vitest";
import { describeStockDue, isStockDeductionDue, parseStockQuantity, planDueStockDeduction, type StockOrder, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";
import type { OrderId } from "@core/src/features/orders/domain/order";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const v1 = id(11) as StockOrder["items"][number]["variantId"];
const v2 = id(12) as typeof v1;
const stock = (entries: [typeof v1, number][]) => new Map(entries) as unknown as VariantStock;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const order = (overrides: Partial<StockOrder> = {}): StockOrder => ({ id: id(1) as OrderId, createdAt: new Date("2026-10-01T10:00:00Z"), cancelled: false,
  stockDeducted: false, deliveryStatus: "pending", total: money(120), items: [{ variantId: v1, quantity: 4 as never }, { variantId: v2, quantity: 1 as never }],
  confirmedPayments: [{ amount: money(120), deductStockIfPartial: false }], ...overrides });

test("an order is due when confirmed payments cover the total", () => {
  expect(isStockDeductionDue(order())).toBe(true);
  expect(isStockDeductionDue(order({ confirmedPayments: [{ amount: money(70), deductStockIfPartial: false }, { amount: money(50), deductStockIfPartial: false }] }))).toBe(true);
  expect(isStockDeductionDue(order({ confirmedPayments: [{ amount: money(200), deductStockIfPartial: false }] }))).toBe(true);
});

test("an order is due when a confirmed partial payment asked to deduct stock", () => {
  expect(isStockDeductionDue(order({ confirmedPayments: [{ amount: money(40), deductStockIfPartial: true }] }))).toBe(true);
});

test("an order is not due when its only partial payment did not ask to deduct stock", () => {
  expect(isStockDeductionDue(order({ confirmedPayments: [{ amount: money(40), deductStockIfPartial: false }] }))).toBe(false);
  expect(isStockDeductionDue(order({ confirmedPayments: [] }))).toBe(false);
});

test("a voided payment that asked to deduct stock no longer makes the order due", () => {
  // Voided payments are not part of confirmedPayments, so only the remaining ones decide.
  expect(isStockDeductionDue(order({ confirmedPayments: [{ amount: money(40), deductStockIfPartial: false }] }))).toBe(false);
});

test("cancelled, deducted or shipped orders are never due", () => {
  expect(isStockDeductionDue(order({ cancelled: true }))).toBe(false);
  expect(isStockDeductionDue(order({ stockDeducted: true }))).toBe(false);
  expect(isStockDeductionDue(order({ deliveryStatus: "shipped" }))).toBe(false);
  expect(isStockDeductionDue(order({ deliveryStatus: "delivered" }))).toBe(false);
});

test("plans the deduction only when every item has enough stock", () => {
  expect(planDueStockDeduction(order(), stock([[v1, 4], [v2, 1]]))).toEqual({ kind: "deduct", lines: [{ variantId: v1, quantity: 4 }, { variantId: v2, quantity: 1 }] });
  expect(planDueStockDeduction(order(), stock([[v1, 3], [v2, 1]])).kind).toBe("short");
  expect(planDueStockDeduction(order({ cancelled: true }), stock([[v1, 9], [v2, 9]]))).toEqual({ kind: "not_due" });
});

test("lists the short items in item order with the available units", () => {
  expect(planDueStockDeduction(order(), stock([[v1, 3]]))).toEqual({ kind: "short", shortItems: [{ variantId: v1, available: 3 }, { variantId: v2, available: 0 }] });
});

test("a variant missing from the stock map counts as zero", () => {
  expect(planDueStockDeduction(order(), stock([[v1, 4]]))).toMatchObject({ kind: "short", shortItems: [{ variantId: v2, available: 0 }] });
});

test("describes a due order with short items as waiting", () => {
  expect(describeStockDue(order(), stock([[v1, 3], [v2, 1]]))).toEqual({ kind: "waiting", shortItems: [{ variantId: v1, available: 3 }] });
});

test("describes a due order whose items all fit as deducting", () => {
  expect(describeStockDue(order(), stock([[v1, 4], [v2, 1]]))).toEqual({ kind: "deducting" });
});

test("describes deducted and not due orders as having no stock due", () => {
  expect(describeStockDue(order({ stockDeducted: true }), stock([]))).toBeNull();
  expect(describeStockDue(order({ confirmedPayments: [] }), stock([]))).toBeNull();
});

test("parses stored stock quantities as non-negative safe integers", () => {
  expect(parseStockQuantity(5n)).toEqual({ success: true, data: 5 });
  expect(parseStockQuantity(-1n)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(parseStockQuantity("x")).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(parseStockQuantity(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toMatchObject({ success: false });
});
