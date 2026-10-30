import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import type { OrderId, PaymentId } from "@core/src/features/orders/domain/order";
import type { DeductionOutcome } from "@core/src/features/orders/application/deduct-due-stock";
import { createInTransactionPublisher, type InTransactionRegistry } from "@core/src/shared/events/application/in-transaction-events";

type Ending = { code: string; message: string };
const company = "00000000-0000-4000-8000-000000000001" as CompanyId;
const event = { companyId: company, orderId: "00000000-0000-4000-8000-000000000002" as OrderId, paymentId: "00000000-0000-4000-8000-000000000003" as PaymentId };
const deducted: DeductionOutcome = { kind: "deducted", stock: new Map() };
const failed: DeductionOutcome = { kind: "failed", stage: "lock_stock", errorCode: "STATEMENT_TIMEOUT" };
const registryOf = (handler: () => Promise<ReturnType<typeof ok<DeductionOutcome>> | ReturnType<typeof err<Ending>>>): InTransactionRegistry<Ending> => ({
  payment_confirmed: handler, order_delivery_changed: handler, order_stock_deduction_overdue: handler,
  product_stock_increased: async () => ok({ candidates: 0, deducted: 0, skippedLocked: 0, skippedInvalid: 0, budgetExhausted: false, failed: null }),
}) as InTransactionRegistry<Ending>;
const passThrough = async (work: () => Promise<unknown>) => work();
const base = { requireTransaction: () => undefined, withinSavepoint: passThrough as never, containedOutcome: (() => failed) as never };

test("runs the event's handler and returns its outcome", async () => {
  const publish = createInTransactionPublisher(registryOf(async () => ok(deducted)), base);
  expect(await publish("payment_confirmed", event)).toEqual(ok(deducted));
});

test("refuses to publish outside a transaction of the payload company", async () => {
  const publish = createInTransactionPublisher(registryOf(async () => ok(deducted)),
    { ...base, requireTransaction: (id) => { if (id !== company) throw new Error("An active transaction for this company is required"); } });
  await expect(publish("payment_confirmed", { ...event, companyId: "other" as CompanyId })).rejects.toThrow("active transaction");
});

test("turns a contained savepoint failure into the event's failed outcome and returns a transaction-ending error", async () => {
  const containedFailure = { code: "CONTAINED_FAILURE", errorCode: "STATEMENT_TIMEOUT", message: "x", cause: null };
  const contained = createInTransactionPublisher(registryOf(async () => ok(deducted)), { ...base, withinSavepoint: (async () => err(containedFailure)) as never });
  expect(await contained("payment_confirmed", event)).toEqual(ok(failed));
  const seen: unknown[] = [];
  const ending = createInTransactionPublisher(registryOf(async () => err({ code: "ENDED", message: "ended" })), { ...base, onTransactionEnding: (name, error) => seen.push([name, error]) });
  expect(await ending("payment_confirmed", event)).toEqual(err({ code: "ENDED", message: "ended" }));
  expect(seen).toEqual([["payment_confirmed", { code: "ENDED", message: "ended" }]]);
});
