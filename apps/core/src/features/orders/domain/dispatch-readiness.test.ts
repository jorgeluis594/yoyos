import { expect, test } from "vitest";
import type { DispatchDate } from "@shared/dispatch-date";
import type { OrderId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { VariantStock } from "@core/src/features/orders/domain/stock-deduction";
import {
  classifyDispatchCandidate, describeDispatchReadiness, orderDispatchQueue, pageOfDispatchQueue, type DispatchCandidate, type DispatchReadiness,
} from "@core/src/features/orders/domain/dispatch-readiness";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const camisaM = id(11) as VariantId;
const camisaL = id(12) as VariantId;
const stock = (entries: [VariantId, number][]) => new Map(entries) as unknown as VariantStock;
const money = (amount: number) => ({ amount, currency: "PEN" as const });
const day = (value: string) => value as DispatchDate;
const candidate = (overrides: Partial<DispatchCandidate> = {}): DispatchCandidate => ({ id: id(1) as OrderId, createdAt: new Date("2026-10-20T10:00:00Z"),
  cancelled: false, stockDeducted: false, deliveryStatus: "pending", total: money(80), items: [{ variantId: camisaM, quantity: 4 as never, deducted: 0 as never }],
  confirmedPayments: [{ amount: money(80), deductStockIfPartial: false }], number: 1050 as OrderNumber, scheduledDispatchDate: day("2026-10-30"),
  deliveryMethod: "home", hasReportedPayment: false, ...overrides });
const classify = (overrides: Partial<DispatchCandidate>, entries: [VariantId, number][] = [[camisaM, 10]]) => classifyDispatchCandidate(candidate(overrides), stock(entries)).readiness;

test("marks a home delivery with a confirmed payment and enough stock as ready to dispatch", () => {
  expect(classify({})).toEqual({ kind: "ready", operation: "ship" });
  expect(classify({ confirmedPayments: [{ amount: money(30), deductStockIfPartial: false }] })).toEqual({ kind: "ready", operation: "ship" });
});

test("blocks a home delivery without confirmed payment with the ship payment reason", () => {
  expect(classify({ confirmedPayments: [] })).toEqual({ kind: "blocked", operation: "ship", reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: false } });
});

test("adds the pending report flag only to payment reasons", () => {
  expect(classify({ confirmedPayments: [], hasReportedPayment: true })).toMatchObject({ reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: true } });
  expect(classify({ hasReportedPayment: true }, [[camisaM, 1]])).toEqual({ kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: [camisaM] } });
});

test("blocks a store pickup with a pending balance with the full payment reason", () => {
  expect(classify({ deliveryMethod: "store", confirmedPayments: [{ amount: money(30), deductStockIfPartial: false }], hasReportedPayment: true }))
    .toEqual({ kind: "blocked", operation: "deliver", reason: { code: "PAYMENT_REQUIRED", pendingReport: true } });
});

test("blocks an order waiting for stock naming only the short items", () => {
  const result = classify({ items: [{ variantId: camisaM, quantity: 4 as never, deducted: 0 as never }, { variantId: camisaL, quantity: 1 as never, deducted: 0 as never }] }, [[camisaM, 3], [camisaL, 5]]);
  expect(result).toEqual({ kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: [camisaM] } });
});

test("blocks a partially paid order whose items exceed current stock although shipping is allowed", () => {
  const result = classifyDispatchCandidate(candidate({ confirmedPayments: [{ amount: money(30), deductStockIfPartial: false }] }), stock([[camisaM, 3]]));
  expect(result.stock).toEqual({ stockDue: null, shortAtCurrentStock: [camisaM] });
  expect(result.readiness).toEqual({ kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: [camisaM] } });
});

test("marks a deducting home delivery as ready and a deducting store pickup as blocked", () => {
  expect(classify({})).toEqual({ kind: "ready", operation: "ship" });
  expect(classify({ deliveryMethod: "store" })).toEqual({ kind: "blocked", operation: "deliver", reason: { code: "STOCK_DEDUCTING" } });
  expect(classify({ deliveryMethod: "agency" })).toEqual({ kind: "ready", operation: "ship" });
});

test("reports delivery unassigned for a pending order without delivery", () => {
  expect(classify({ deliveryMethod: null })).toEqual({ kind: "delivery_unassigned" });
});

test("returns no readiness for a cancelled order", () => {
  expect(classify({ cancelled: true })).toBeNull();
  expect(describeDispatchReadiness(candidate({ deliveryStatus: "shipped" }), { stockDue: null, shortAtCurrentStock: [] })).toBeNull();
});

const member = (number: number, date: string, readiness: DispatchReadiness) => ({ candidate: candidate({ number: number as OrderNumber, id: id(number) as OrderId, scheduledDispatchDate: day(date) }), readiness });
const ready: DispatchReadiness = { kind: "ready", operation: "ship" };
const blocked: DispatchReadiness = { kind: "blocked", operation: "ship", reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: false } };
const numbersOf = (queue: ReturnType<typeof orderDispatchQueue>) => queue.members.map((entry) => [entry.candidate.number, entry.group]);

test("orders overdue before today, ready before blocked, oldest date then lowest number", () => {
  const queue = orderDispatchQueue([
    member(1054, "2026-10-30", blocked), member(1050, "2026-10-30", ready), member(1048, "2026-10-28", ready), member(1047, "2026-10-29", ready),
    member(1046, "2026-10-27", blocked), member(1049, "2026-10-28", ready), member(1051, "2026-10-30", { kind: "delivery_unassigned" }),
  ], day("2026-10-30"));
  expect(numbersOf(queue)).toEqual([[1048, "overdue"], [1049, "overdue"], [1047, "overdue"], [1046, "overdue"], [1050, "today"], [1051, "today"], [1054, "today"]]);
  expect(queue.summary).toEqual({ overdue: 4, overdueReady: 3, today: 3, todayReady: 1 });
});

test("paginates overdue and today as one sequence of twenty", () => {
  const members = [...Array.from({ length: 3 }, (_, index) => member(1001 + index, "2026-10-28", ready)),
    ...Array.from({ length: 25 }, (_, index) => member(1100 + index, "2026-10-30", ready))];
  const queue = orderDispatchQueue(members, day("2026-10-30"));
  const first = pageOfDispatchQueue(queue, 1 as never);
  const second = pageOfDispatchQueue(queue, 2 as never);
  expect(first.map((entry) => entry.group)).toEqual([...Array(3).fill("overdue"), ...Array(17).fill("today")]);
  expect(second).toHaveLength(8);
  expect(pageOfDispatchQueue(queue, 3 as never)).toEqual([]);
  expect(queue.summary).toEqual({ overdue: 3, overdueReady: 3, today: 25, todayReady: 25 });
});

test("judges a full order by the same rules as the queue through its readiness subject", async () => {
  const { toReadinessSubject, describeDispatchReadiness: describe } = await import("@core/src/features/orders/domain/dispatch-readiness");
  const confirmed = { status: "confirmed", amount: money(30), method: "bank_transfer", deductStockIfPartial: false } as const;
  const aggregate = { id: id(1), createdAt: new Date("2026-10-20T10:00:00Z"), cancelled: false, stockDeducted: false, deliveryStatus: "pending", total: money(80),
    items: [{ variantId: camisaM, quantity: 4 }], payments: [confirmed, { status: "reported" }], delivery: { method: "home" } } as never;
  const subject = toReadinessSubject(aggregate);
  expect(subject).toMatchObject({ deliveryMethod: "home", hasReportedPayment: true, confirmedPayments: [{ amount: money(30) }] });
  expect(describe(subject, { stockDue: null, shortAtCurrentStock: [camisaM] })).toEqual({ kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: [camisaM] } });
  expect(describe(subject, { stockDue: null, shortAtCurrentStock: [] })).toEqual({ kind: "ready", operation: "ship" });
});
