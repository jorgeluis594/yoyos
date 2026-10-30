import { expect, test } from "vitest";
import { ok } from "@shared/functional";
import { registerImmediateSale, type RegisterImmediateSaleDependencies } from "@core/src/features/orders/application/register-immediate-sale";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import type { CompanyId, OrderId, OrderItemId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import type { VariantId } from "@core/src/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { companyId: id(1) as CompanyId, userId: "seller" as UserId };
const variantId = id(3) as VariantId;
const input = { id: id(2) as OrderId, items: [{ variantId, quantity: 2 as PositiveInteger }] as const };

function fixture(outcome: DeductionOutcome) {
  const events: unknown[] = [];
  const deps: RegisterImmediateSaleDependencies = {
    transaction: async (_company, work) => work(),
    orderExists: async () => ok(false),
    findVariants: async () => ok([{ variantId, productName: "Camisa", variantAttributes: {}, sku: null, unitPrice: { amount: 10, currency: "PEN" } }]),
    allocateNumber: async () => ok(1001 as OrderNumber),
    saveOrder: async () => ok(null),
    savePayment: async () => ok(null),
    publishPaymentConfirmed: async (event) => { events.push(event); return ok(outcome); },
    saveFulfillment: async () => ok(null),
    newItemId: () => id(5) as OrderItemId, newPaymentId: () => id(6) as PaymentId, clock: () => new Date("2026-10-30T12:00:00Z"),
  };
  return { deps, events };
}

test("delivers an immediate sale whose stock was deducted", async () => {
  const f = fixture({ kind: "deducted", stock: new Map(), deductedAt: new Date("2026-09-30T12:00:00Z") });
  expect(await registerImmediateSale(input, context, f.deps)).toMatchObject({ success: true, data: { deliveryStatus: "delivered", stockDeducted: true } });
  expect(f.events).toEqual([{ companyId: context.companyId, orderId: input.id, paymentId: id(6) }]);
});

test("refuses an immediate sale with short stock and names the short variant", async () => {
  const f = fixture({ kind: "short", shortItems: [{ variantId, available: 1 as never }] });
  expect(await registerImmediateSale(input, context, f.deps)).toMatchObject({ success: false, error: { code: "INSUFFICIENT_STOCK", variantId } });
});

test("answers a data fault of the deduction as INVALID_STORED_DATA, never as insufficient stock", async () => {
  for (const errorCode of ["INVALID_STORED_DATA", "UNEXPECTED_ROW_COUNT"] as const) {
    const f = fixture({ kind: "failed", stage: "lock_stock", errorCode });
    expect(await registerImmediateSale(input, context, f.deps)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
  }
});

test("answers a contended deduction as PERSISTENCE_UNAVAILABLE so the seller retries", async () => {
  for (const errorCode of ["LOCK_TIMEOUT", "STATEMENT_TIMEOUT", "DEADLOCK", "DATABASE_ERROR"] as const) {
    const f = fixture({ kind: "failed", stage: "lock_stock", errorCode });
    expect(await registerImmediateSale(input, context, f.deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
  }
  const locked = fixture({ kind: "skipped_locked" });
  expect(await registerImmediateSale(input, context, locked.deps)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});
