import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { OrderAggregateResponse } from "@shared/contracts/orders";
import { readCancellationOrder, verifyCancellation, type CancellationUiState } from "@core/src/features/orders/presentation/cancellation-client";
const id = "00000000-0000-4000-8000-000000000001";
const money = { amount: 10, currency: "PEN" as const };
function order(): OrderAggregateResponse {
  return { id, companyId: id, sellerId: "seller", number: 1001, buyer: null, checkoutEnabledAt: null, checkoutConfirmedAt: null,
    checkoutDeliveryRequest: null, createdAt: "2026-10-07T10:00:00Z", deliveredAt: null, completedAt: null, status: "active", cancelled: false,
    deliveryStatus: "pending", stockDeducted: false, delivery: null, payments: [], items: [{ id, variantId: id, productName: "Item", variantAttributes: {}, sku: null, quantity: 1, unitPrice: money, subtotal: money }],
    total: money, itemsTotal: money, deliveryCost: { ...money, amount: 0 }, deliveryCharge: { ...money, amount: 0 },
    paymentStatus: "pending", paidAmount: { ...money, amount: 0 }, balanceDue: money, overpaidAmount: { ...money, amount: 0 } };
}

test.each(["cancelled", "active", "shipped"] as const)("verification resolves %s with one read", async state => {
  const data: OrderAggregateResponse = state === "cancelled" ? { ...order(), cancelled: true, status: "cancelled" }
    : state === "shipped" ? { ...order(), deliveryStatus: "shipped", stockDeducted: true } : order();
  const read = vi.fn(async () => ok(data));
  const result = await verifyCancellation(id, { code: "INTERNAL_ERROR", message: "Response lost" }, read);
  expect(result).toMatchObject({ operation: "cancellation", orderId: id, outcome: { kind: state === "cancelled" ? "confirmed" : "failed", order: data } });
  expect(read).toHaveBeenCalledOnce();
});

test("unavailability stays uncertain but absence remains a known failure", async () => {
  expect(await verifyCancellation(id, { code: "INTERNAL_ERROR", message: "Lost" }, async () => err({ code: "INTERNAL_ERROR", message: "Offline" })))
    .toMatchObject({ outcome: { kind: "uncertain" } });
  expect(await verifyCancellation(id, { code: "INTERNAL_ERROR", message: "Lost" }, async () => err({ code: "ORDER_NOT_FOUND", message: "Missing" })))
    .toMatchObject({ outcome: { kind: "failed", error: { code: "ORDER_NOT_FOUND" } } });
});

test.each(["other_id", "cancelled_shipped", "malformed"])("rejects %s read response", async variant => {
  const body = variant === "other_id" ? { ...order(), id: "00000000-0000-4000-8000-000000000002" }
    : variant === "cancelled_shipped" ? { ...order(), cancelled: true, status: "cancelled", deliveryStatus: "shipped" } : {};
  vi.stubGlobal("fetch", async () => Response.json(body));
  try { expect(await readCancellationOrder(id)).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } }); }
  finally { vi.unstubAllGlobals(); }
});

test("a failed conflict reload preserves the definitive rejection without inventing a state", async () => {
  expect(await verifyCancellation(id, { code: "INVALID_TRANSITION", message: "Dispatched" }, async () => err({ code: "INTERNAL_ERROR", message: "Offline" })))
    .toMatchObject({ outcome: { kind: "failed", error: { code: "INVALID_TRANSITION" }, refreshFailed: true } });
});

test("expired authentication is preserved instead of becoming a cancellation result", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 401 }));
  try { await expect(readCancellationOrder(id)).rejects.toMatchObject({ status: 401 }); }
  finally { vi.unstubAllGlobals(); }
});

test("UI state prevents mixed busy and uncertain data", () => {
  const busy: CancellationUiState = { kind: "submitting", orderId: id };
  // @ts-expect-error Busy states require an order identity.
  const missing: CancellationUiState = { kind: "submitting" };
  // @ts-expect-error Failed states cannot carry uncertain-only data.
  const mixed: CancellationUiState = { kind: "failed", error: { code: "INTERNAL_ERROR", message: "Failed" }, orderId: id };
  expect(busy.kind).toBe("submitting"); void [missing, mixed];
});
