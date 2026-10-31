import { expect, test } from "vitest";
import { describeStockDue, hasPendingStock, isStockDeductionDue, parseStockQuantity, planDueStockDeduction, planStockAdjustment, type StockOrder, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";
import type { OrderId } from "@core/src/features/orders/domain/order";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const v1 = id(11) as StockOrder["items"][number]["variantId"];
const v2 = id(12) as typeof v1;
const stock = (entries: [typeof v1, number][]) => new Map(entries) as unknown as VariantStock;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const order = (overrides: Partial<StockOrder> = {}): StockOrder => ({ id: id(1) as OrderId, createdAt: new Date("2026-10-01T10:00:00Z"), cancelled: false,
  stockDeducted: false, deliveryStatus: "pending", total: money(120), items: [{ variantId: v1, quantity: 4 as never, deducted: 0 as never }, { variantId: v2, quantity: 1 as never, deducted: 0 as never }],
  confirmedPayments: [{ amount: money(120), deductStockIfPartial: false }], ...overrides });

const settled: StockOrder["items"] = [{ variantId: v1, quantity: 4 as never, deducted: 4 as never }, { variantId: v2, quantity: 1 as never, deducted: 1 as never }];
const partial: StockOrder["items"] = [{ variantId: v1, quantity: 6 as never, deducted: 4 as never }, { variantId: v2, quantity: 1 as never, deducted: 1 as never }];

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
  expect(isStockDeductionDue(order({ stockDeducted: true, items: settled }))).toBe(false);
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
  expect(describeStockDue(order({ stockDeducted: true, items: settled }), stock([]))).toBeNull();
  expect(describeStockDue(order({ confirmedPayments: [] }), stock([]))).toBeNull();
});

test("parses stored stock quantities as non-negative safe integers", () => {
  expect(parseStockQuantity(5n)).toEqual({ success: true, data: 5 });
  expect(parseStockQuantity(-1n)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(parseStockQuantity("x")).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  expect(parseStockQuantity(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toMatchObject({ success: false });
});

test("a deducted order with pending units is due without payments, and one without them is not", () => {
  const deductedPartial = order({ stockDeducted: true, items: partial, confirmedPayments: [] });
  expect(hasPendingStock(deductedPartial)).toBe(true);
  expect(isStockDeductionDue(deductedPartial)).toBe(true);
  expect(hasPendingStock(order({ stockDeducted: true, items: settled }))).toBe(false);
  expect(isStockDeductionDue(order({ stockDeducted: true, items: partial, cancelled: true }))).toBe(false);
  expect(isStockDeductionDue(order({ stockDeducted: true, items: partial, deliveryStatus: "shipped" }))).toBe(false);
});

test("plans the pending part of a deducted order, all or nothing", () => {
  const deductedPartial = order({ stockDeducted: true, items: partial });
  expect(planDueStockDeduction(deductedPartial, stock([[v1, 2]]))).toEqual({ kind: "deduct", lines: [{ variantId: v1, quantity: 2 }] });
  expect(planDueStockDeduction(deductedPartial, stock([[v1, 1]]))).toEqual({ kind: "short", shortItems: [{ variantId: v1, available: 1 }] });
});

test("describes a deducted order with pending units as partial waiting, or deducting when they fit", () => {
  const deductedPartial = order({ stockDeducted: true, items: partial });
  expect(describeStockDue(deductedPartial, stock([[v1, 1]]))).toEqual({ kind: "partial_waiting", shortItems: [{ variantId: v1, available: 1 }] });
  expect(describeStockDue(deductedPartial, stock([[v1, 2]]))).toEqual({ kind: "deducting" });
});

const line = (variantId: typeof v1, quantity: number, deducted: number) => ({ variantId, quantity: quantity as never, deducted: deducted as never });
const v3 = id(13) as typeof v1;

test("an adjustment returns the surplus of a decreased line", () => {
  const plan = planStockAdjustment([line(v1, 2, 4)], new Map(), stock([[v1, 0]]));
  expect(plan).toEqual({ returns: [{ variantId: v1, quantity: 2 }], deductions: [], deductedByVariant: new Map([[v1, 2]]), pending: [] });
});

test("an adjustment deducts the increase when it fits", () => {
  const plan = planStockAdjustment([line(v1, 7, 4)], new Map(), stock([[v1, 3]]));
  expect(plan).toEqual({ returns: [], deductions: [{ variantId: v1, quantity: 3 }], deductedByVariant: new Map([[v1, 7]]), pending: [] });
});

test("an adjustment deducts a new line from zero", () => {
  const plan = planStockAdjustment([line(v1, 4, 4), line(v3, 2, 0)], new Map(), stock([[v3, 5]]));
  expect(plan.deductions).toEqual([{ variantId: v3, quantity: 2 }]);
  expect(plan.deductedByVariant).toEqual(new Map([[v3, 2]]));
});

test("an adjustment returns the deducted units of a removed line", () => {
  const plan = planStockAdjustment([line(v1, 4, 4)], new Map([[v2, 1]]), stock([]));
  expect(plan.returns).toEqual([{ variantId: v2, quantity: 1 }]);
  expect(plan.deductions).toEqual([]);
});

test("a short increase deducts what fits and leaves the rest pending", () => {
  const plan = planStockAdjustment([line(v1, 9, 4)], new Map(), stock([[v1, 2]]));
  expect(plan.deductions).toEqual([{ variantId: v1, quantity: 2 }]);
  expect(plan.deductedByVariant).toEqual(new Map([[v1, 6]]));
  expect(plan.pending).toEqual([{ variantId: v1, available: 0 }]);
});

test("an increase with no stock changes nothing and stays pending", () => {
  const plan = planStockAdjustment([line(v1, 6, 4)], new Map(), stock([]));
  expect(plan).toEqual({ returns: [], deductions: [], deductedByVariant: new Map(), pending: [{ variantId: v1, available: 0 }] });
});

test("an adjustment of settled lines is a no-op, so applying it twice changes nothing", () => {
  const plan = planStockAdjustment([line(v1, 4, 4), line(v2, 1, 1)], new Map(), stock([[v1, 9]]));
  expect(plan).toEqual({ returns: [], deductions: [], deductedByVariant: new Map(), pending: [] });
});

test("an adjustment lists units in variantId order", () => {
  const plan = planStockAdjustment([line(v3, 1, 3), line(v1, 1, 2)], new Map([[v2, 5]]), stock([]));
  expect(plan.returns.map((units) => units.variantId)).toEqual([v1, v2, v3]);
});
