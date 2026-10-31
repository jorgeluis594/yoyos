import { afterAll, describe, expect, test } from "vitest";
import { withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { orders } from "@core/src/features/orders/composition";
import type { CompanyId, UserId } from "@core/src/features/orders/domain/order";
import type { SalesFigures, SalesSummary, SummarizeSalesInput } from "@core/src/features/orders/application/summarize-sales";
import { readSalesFigures } from "@core/src/features/orders/infrastructure/sales-summary-repository";
import { createSalesStore, lima, seedOctoberExample, type SalesStore } from "../../../../tests/support/sales-summary-seed";

const stores: SalesStore[] = [];
const newStore = async (name: string) => { const store = await createSalesStore(name); stores.push(store); return store; };
afterAll(async () => { for (const store of stores) await store.dispose(); });

const window = (from: string, through: string) => ({ from: lima(`${from}T00:00`), before: lima(`${through}T00:00`) });
const october: SummarizeSalesInput = { current: window("2026-10-01", "2026-11-01"), previous: window("2026-09-01", "2026-10-01") };

async function summarize(store: SalesStore, input: SummarizeSalesInput = october): Promise<SalesSummary> {
  const read = await withTenantIsolation(store.companyId, () => readSalesFigures(input, store.companyId as CompanyId));
  if (!read.success) throw new Error(read.error.message);
  return read.data;
}
const pen = (figures: readonly SalesFigures[]) => figures.find((entry) => entry.currency === "PEN");
const amounts = (figures: SalesFigures | undefined) => figures && ({
  orders: figures.orders, items: figures.items.amount, charges: figures.deliveryCharges.amount, total: figures.total.amount,
  received: figures.received.amount, owed: figures.owed.amount, overpaid: figures.overpaid.amount,
});

describe("the sales summary read", () => {
  test("sums the October example: voided, rejected and reported payments add nothing and the unconfirmed catalog order does not exist", async () => {
    const store = await newStore("Tienda Rosa");
    await seedOctoberExample(store);
    const summary = await summarize(store);
    expect(amounts(pen(summary.current))).toEqual({ orders: 4, items: 640, charges: 40, total: 680, received: 380, owed: 310, overpaid: 10 });
    expect(pen(summary.current)!.receivedBy.map((by) => [by.walletProvider, by.amount.amount]).sort()).toEqual([["plin", 50], ["yape", 330]]);
    expect(summary.pendingReports).toEqual({ reports: 1, orders: 1 });
    expect(summary.previous).toEqual([]);
    expect(680).toBe(380 + 310 - 10);
  });

  test("keeps cancelled orders out of sales and counts their confirmed payments in the cancelled line only", async () => {
    const store = await newStore("Cancelados");
    await seedOctoberExample(store);
    const { cancelled } = pen((await summarize(store)).current)!;
    expect(cancelled).toEqual({ orders: 1, total: { amount: 100, currency: "PEN" }, confirmed: { amount: 40, currency: "PEN" } });
  });

  test("counts pending reports and the orders holding them, never on cancelled orders", async () => {
    const store = await newStore("Reportes");
    await store.sell({ number: 1001, createdAt: lima("2026-10-05T10:00"), items: 50, payments: [{ status: "reported" }, { status: "reported" }] });
    await store.sell({ number: 1002, createdAt: lima("2026-10-06T10:00"), items: 50, payments: [{ status: "reported" }] });
    await store.sell({ number: 1003, createdAt: lima("2026-10-07T10:00"), items: 50, cancelled: true, payments: [{ status: "reported" }] });
    await store.sell({ number: 1004, createdAt: lima("2026-09-07T10:00"), items: 50, payments: [{ status: "reported" }] });
    expect((await summarize(store)).pendingReports).toEqual({ reports: 3, orders: 2 });
  });

  test("groups figures by currency and never adds two currencies", async () => {
    const store = await newStore("Dos monedas");
    await store.sell({ number: 1001, createdAt: lima("2026-10-05T10:00"), items: 100, payments: [{ status: "confirmed", amount: 100, method: "bank_transfer" }] });
    await store.sell({ number: 1002, createdAt: lima("2026-10-06T10:00"), items: 30, currency: "USD", payments: [{ status: "confirmed", amount: 10, method: "bank_transfer" }] });
    await store.sell({ number: 1003, createdAt: lima("2026-09-06T10:00"), items: 20, currency: "USD" });
    const summary = await summarize(store);
    expect(summary.current.map((entry) => entry.currency)).toEqual(["PEN", "USD"]);
    expect(amounts(pen(summary.current))).toMatchObject({ orders: 1, total: 100, received: 100, owed: 0 });
    expect(amounts(summary.current.find((entry) => entry.currency === "USD"))).toMatchObject({ orders: 1, total: 30, received: 10, owed: 20 });
    expect(summary.previous.map((entry) => [entry.currency, entry.total.amount])).toEqual([["USD", 20]]);
  });

  test("another store's orders and payments change no figure", async () => {
    const store = await newStore("Mi tienda");
    const other = await newStore("Otra tienda");
    await seedOctoberExample(other);
    await store.sell({ number: 1001, createdAt: lima("2026-10-05T10:00"), items: 50 });
    const summary = await summarize(store);
    expect(amounts(pen(summary.current))).toMatchObject({ orders: 1, total: 50, received: 0 });
    expect(summary.pendingReports).toEqual({ reports: 0, orders: 0 });
  });

  test("an order at 23:30 Lima on 31/10 counts in October and one at 00:05 on 01/11 in November", async () => {
    const store = await newStore("Medianoche");
    await store.sell({ number: 1001, createdAt: lima("2026-10-31T23:30"), items: 10 });
    await store.sell({ number: 1002, createdAt: lima("2026-11-01T00:05"), items: 20 });
    expect(amounts(pen((await summarize(store)).current))).toMatchObject({ orders: 1, total: 10 });
    const november = await summarize(store, { current: window("2026-11-01", "2026-12-01"), previous: window("2026-10-01", "2026-11-01") });
    expect(amounts(pen(november.current))).toMatchObject({ orders: 1, total: 20 });
    expect(amounts(pen(november.previous))).toMatchObject({ orders: 1, total: 10 });
  });

  test("a previous period that leaves a gap excludes the gap: with today 20/10 an order of 25/09 changes neither the October-to-date figures nor the 01/09–20/09 previous figures", async () => {
    const store = await newStore("Hueco");
    await store.sell({ number: 1001, createdAt: lima("2026-10-05T10:00"), items: 100 });
    await store.sell({ number: 1002, createdAt: lima("2026-09-15T10:00"), items: 40 });
    const input: SummarizeSalesInput = { current: window("2026-10-01", "2026-10-21"), previous: window("2026-09-01", "2026-09-21") };
    const before = await summarize(store, input);
    await store.sell({ number: 1003, createdAt: lima("2026-09-25T10:00"), items: 999 });
    const after = await summarize(store, input);
    expect(after.current).toEqual(before.current);
    expect(after.previous).toEqual(before.previous);
    expect(amounts(pen(after.previous))).toMatchObject({ orders: 1, total: 40 });
  });

  test("storeHasOrders ignores an unconfirmed catalog order and sees a cancelled one", async () => {
    const unconfirmed = await newStore("Solo catálogo");
    await unconfirmed.sell({ number: 1001, createdAt: lima("2026-10-05T10:00"), items: 50, unconfirmedCatalog: true });
    expect((await summarize(unconfirmed)).storeHasOrders).toBe(false);
    const cancelled = await newStore("Solo cancelado");
    await cancelled.sell({ number: 1001, createdAt: lima("2025-01-05T10:00"), items: 50, cancelled: true });
    const summary = await summarize(cancelled);
    expect(summary.storeHasOrders).toBe(true);
    expect(summary.current).toEqual([]);
  });

  test("the owed figure over a period covering every order equals the owed of Pedidos por cobrar", async () => {
    const store = await newStore("Por cobrar");
    await seedOctoberExample(store);
    await store.sell({ number: 2001, createdAt: lima("2026-09-10T10:00"), items: 80, payments: [{ status: "confirmed", amount: 30, method: "bank_transfer" }] });
    const all = { current: window("2026-09-01", "2026-11-01"), previous: window("2026-07-01", "2026-09-01") };
    const owed = pen((await summarize(store, all)).current)!.owed.amount;
    const unpaid = await withTenantIsolation(store.companyId, () => orders.summarizeUnpaid({}, { companyId: store.companyId as CompanyId, userId: store.sellerId as UserId }));
    if (!unpaid.success) throw new Error(unpaid.error.message);
    expect(unpaid.data.owed).toEqual([{ amount: owed, currency: "PEN" }]);
  });
});
