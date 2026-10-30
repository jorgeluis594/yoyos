import { expect, test } from "vitest";
import { err, ok } from "@shared/functional";
import type { CompanyId } from "@shared/identity";
import { createInTransactionPublisher, type InTransactionRegistry } from "@core/src/shared/events/application/in-transaction-events";

declare module "@core/src/shared/events/application/in-transaction-events" {
  interface InTransactionEvents { test_event: { payload: { companyId: CompanyId; value: number }; outcome: { doubled: number } | { failed: true } } }
}
const company = "00000000-0000-4000-8000-000000000001" as CompanyId;
const passThrough = async <T, F>(work: () => Promise<T>) => work() as never;
const base = { requireTransaction: () => undefined, withinSavepoint: passThrough as never,
  containedOutcome: () => ({ failed: true as const }) };

test("runs the event's handler and returns its outcome", async () => {
  const registry: InTransactionRegistry<{ code: string }> = { test_event: async ({ value }) => ok({ doubled: value * 2 }) };
  const publish = createInTransactionPublisher(registry, base);
  expect(await publish("test_event", { companyId: company, value: 4 })).toEqual(ok({ doubled: 8 }));
});

test("refuses to publish outside a transaction of the payload company", async () => {
  const registry: InTransactionRegistry<{ code: string }> = { test_event: async () => ok({ doubled: 0 }) };
  const publish = createInTransactionPublisher(registry, { ...base, requireTransaction: (id) => { if (id !== company) throw new Error("An active transaction for this company is required"); } });
  await expect(publish("test_event", { companyId: "other" as CompanyId, value: 1 })).rejects.toThrow("active transaction");
});

test("turns a contained savepoint failure into the event's failed outcome and returns a transaction-ending error", async () => {
  const containedFailure = { code: "CONTAINED_FAILURE", errorCode: "STATEMENT_TIMEOUT", message: "x", cause: null };
  const registry: InTransactionRegistry<{ code: string }> = { test_event: async () => err({ code: "ENDED" }) };
  const seen: unknown[] = [];
  const contained = createInTransactionPublisher(registry, { ...base, withinSavepoint: (async () => err(containedFailure)) as never });
  expect(await contained("test_event", { companyId: company, value: 1 })).toEqual(ok({ failed: true }));
  const ending = createInTransactionPublisher(registry, { ...base, onTransactionEnding: (name, error) => seen.push([name, error]),
    withinSavepoint: (async (work: () => Promise<unknown>) => work()) as never });
  expect(await ending("test_event", { companyId: company, value: 1 })).toEqual(err({ code: "ENDED" }));
  expect(seen).toEqual([["test_event", { code: "ENDED" }]]);
});
