import { describe, expect, test } from "vitest";
import { toSalesSummaryOutput, type ProjectableFigures, type ProjectableSalesSummary, type SalesSummaryContext } from "@core/src/features/assistants/domain/sales-projection";
import { previousPeriod, resolveSalesPeriod, type SalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import { display } from "@core/src/features/assistants/presentation/display";

const money = (amount: number, currency = "PEN") => ({ amount, currency });
const noReports = { reports: 0, orders: 0 };

function figures({ total, ...over }: Partial<Omit<ProjectableFigures, "total">> & { currency?: string; total: number }): ProjectableFigures {
  const currency = over.currency ?? "PEN";
  const m = (amount: number) => money(amount, currency);
  return {
    currency, orders: 1, items: m(total), deliveryCharges: m(0), total: m(total), received: m(total), owed: m(0), overpaid: m(0),
    receivedBy: [{ label: "Yape", amount: m(total) }], cancelled: { orders: 0, total: m(0), confirmed: m(0) },
    ...over,
  };
}
// Written out so the October example reads as the product definition does.
const october: ProjectableFigures = figures({
  total: 680, orders: 4, items: money(640), deliveryCharges: money(40), received: money(380), owed: money(310), overpaid: money(10),
  receivedBy: [{ label: "Plin", amount: money(50) }, { label: "Yape", amount: money(330) }], cancelled: { orders: 1, total: money(100), confirmed: money(40) },
});
const september = figures({ total: 600, orders: 3, received: money(500), owed: money(100), receivedBy: [{ label: "Yape", amount: money(500) }] });
const summary = (over: Partial<ProjectableSalesSummary> = {}): ProjectableSalesSummary => ({ current: [october], previous: [], pendingReports: { reports: 1, orders: 1 }, storeHasOrders: true, ...over });

function context(from: string, through: string, today: string, over: Partial<SalesPeriod> = {}): SalesSummaryContext {
  const period = { from, through, cutToToday: false, ...over };
  return { display, period, previous: previousPeriod(period), today, storeCurrency: "PEN" };
}
const closedOctober = context("2026-10-01", "2026-10-31", "2026-11-05");
const project = (over: Partial<ProjectableSalesSummary> = {}, ctx: SalesSummaryContext = closedOctober) => toSalesSummaryOutput(summary(over), ctx);
const cancelledMoneyLine = "En pedidos cancelados hay S/ 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.";

describe("the sales summary projection", () => {
  test("projects the October example: sales, products, deliveries, orders, ticket, received by method, owed, overpaid, review and cancelled lines", () => {
    const { output, empty } = project();
    expect(empty).toBe(false);
    expect(output.periodo).toBe("Del 01/10/2026 al 31/10/2026");
    expect(output.significado).toBe("Ventas son los pedidos registrados en estas fechas, pagados o no. Recibido son los pagos confirmados de esas ventas, aunque se confirmaran después: no es lo que entró a tu cuenta en estas fechas. Por cobrar es lo que aún deben estas ventas, no todo lo que te deben.");
    expect(output.pagos_por_revisar).toBe("1 pago reportado por revisar, en 1 pedido. Se aprueba o rechaza en Yoyos.");
    expect(output.bloques).toHaveLength(1);
    expect(output.bloques[0]).toMatchObject({
      moneda: "PEN", ventas: "S/ 680.00 (productos S/ 640.00, envíos S/ 40.00)", pedidos: 4, ticket_promedio: "S/ 170.00", recibido: "S/ 380.00",
      por_medio_de_pago: ["Yape: S/ 330.00 (87%)", "Plin: S/ 50.00 (13%)"], por_cobrar_de_estas_ventas: "S/ 310.00", exceso_recibido: "S/ 10.00",
      cancelados: ["1 pedido cancelado (S/ 100.00) no cuenta en las ventas.", cancelledMoneyLine],
    });
    expect(output.bloques[0]).not.toHaveProperty("periodo_abierto");
  });

  test("projects the summary after voiding a confirmed payment of #1001", () => {
    const voided = figures({ total: 680, orders: 4, items: money(640), deliveryCharges: money(40), received: money(260), owed: money(430), overpaid: money(10),
      receivedBy: [{ label: "Yape", amount: money(210) }, { label: "Plin", amount: money(50) }], cancelled: october.cancelled });
    expect(project({ current: [voided] }).output.bloques[0]).toMatchObject({
      recibido: "S/ 260.00", por_medio_de_pago: ["Yape: S/ 210.00 (81%)", "Plin: S/ 50.00 (19%)"], por_cobrar_de_estas_ventas: "S/ 430.00",
    });
  });

  test("shows no money-on-cancelled line once the cancelled order holds no confirmed payment", () => {
    const voided = { ...october, cancelled: { orders: 1, total: money(100), confirmed: money(0) } };
    expect(project({ current: [voided] }).output.bloques[0]!.cancelados).toEqual(["1 pedido cancelado (S/ 100.00) no cuenta en las ventas."]);
  });

  test("shows Recibido S/ 0.00 and no method breakdown when no payment is confirmed", () => {
    const unpaid = figures({ total: 50, received: money(0), owed: money(50), receivedBy: [] });
    const block = project({ current: [unpaid], pendingReports: noReports }).output.bloques[0]!;
    expect(block).toMatchObject({ recibido: "S/ 0.00", sin_pagos: "Todavía no hay pagos confirmados de estas ventas.", por_cobrar_de_estas_ventas: "S/ 50.00" });
    expect(block).not.toHaveProperty("por_medio_de_pago");
    expect(block).not.toHaveProperty("exceso_recibido");
  });

  test("adds the open-period line only when the period read ends today", () => {
    const open = project({ current: [september] }, context("2026-10-01", "2026-10-20", "2026-10-20")).output.bloques[0]!;
    expect(open.periodo_abierto).toBe("Este periodo sigue abierto: su recibido puede subir mientras se pagan sus ventas.");
    expect(project({ current: [september] }).output.bloques[0]).not.toHaveProperty("periodo_abierto");
  });

  test("shows (hasta hoy) in the header when a future hasta was cut to today, and a plain header otherwise", () => {
    const cut = resolveSalesPeriod({ hasta: "2026-10-31", desde: "2026-10-01" }, "2026-10-20");
    if (!cut.success) throw new Error("unexpected refusal");
    expect(project({}, context("2026-10-01", "2026-10-20", "2026-10-20", { cutToToday: cut.data.cutToToday })).output.periodo).toBe("Del 01/10/2026 al 20/10/2026 (hasta hoy)");
    expect(project({}, context("2026-10-01", "2026-10-20", "2026-10-20")).output.periodo).toBe("Del 01/10/2026 al 20/10/2026");
  });

  test("projects the October example comparison: header with septiembre de 2026 and the four lines for sales, orders, ticket and received", () => {
    const { comparacion } = project({ previous: [september] }).output.bloques[0]!;
    expect(comparacion).toEqual({
      encabezado: "Comparado con el periodo anterior (septiembre de 2026, del 01/09/2026 al 30/09/2026):",
      lineas: [
        "Ventas: S/ 680.00 en este periodo y S/ 600.00 en el anterior: S/ 80.00 más que en el anterior (+13%).",
        "Pedidos: 4 en este periodo y 3 en el anterior: 1 más que en el anterior (+33%).",
        "Ticket promedio: S/ 170.00 en este periodo y S/ 200.00 en el anterior: S/ 30.00 menos que en el anterior (−15%).",
        "Recibido: S/ 380.00 en este periodo y S/ 500.00 en el anterior: S/ 120.00 menos que en el anterior (−24%).",
      ],
    });
  });

  test("names the previous period without a month name when it is not exactly one calendar month, and says igual when a figure did not change", () => {
    const same = figures({ total: 680, orders: 4, received: money(380), receivedBy: [{ label: "Yape", amount: money(380) }] });
    const { comparacion } = project({ previous: [same] }, context("2026-10-01", "2026-10-20", "2026-11-05")).output.bloques[0]!;
    expect(comparacion!.encabezado).toBe("Comparado con el periodo anterior (del 01/09/2026 al 20/09/2026):");
    expect(comparacion!.lineas[0]).toBe("Ventas: S/ 680.00 en este periodo y S/ 680.00 en el anterior: igual que en el anterior.");
  });

  test("projects three methods of S/ 10.00 as 33% each and S/ 601.00 against S/ 600.00 as S/ 1.00 más que en el anterior (menos de 1%)", () => {
    const three = figures({ total: 601, orders: 1, received: money(30), receivedBy: ["Yape", "Plin", "Transferencia bancaria"].map((label) => ({ label, amount: money(10) })) });
    const block = project({ current: [three], previous: [figures({ total: 600, orders: 1 })] }).output.bloques[0]!;
    expect(block.por_medio_de_pago).toEqual(["Plin: S/ 10.00 (33%)", "Transferencia bancaria: S/ 10.00 (33%)", "Yape: S/ 10.00 (33%)"]);
    expect(block.comparacion!.lineas[0]).toBe("Ventas: S/ 601.00 en este periodo y S/ 600.00 en el anterior: S/ 1.00 más que en el anterior (menos de 1%).");
  });

  test("shows Sin ventas en el periodo anterior with no comparison lines when only this period has sales", () => {
    expect(project().output.bloques[0]!.comparacion).toEqual({ encabezado: "Sin ventas en el periodo anterior (del 01/09/2026 al 30/09/2026).", lineas: [] });
  });

  test("shows a received method under 0.5% as menos de 1% and lists methods largest first then by name", () => {
    const skewed = figures({ total: 1000, received: money(1000.2), receivedBy: [{ label: "Plin", amount: money(0.2) }, { label: "Yape", amount: money(1000) }]  });
    expect(project({ current: [skewed] }).output.bloques[0]!.por_medio_de_pago).toEqual(["Yape: S/ 1,000.00 (100%)", "Plin: S/ 0.20 (menos de 1%)"]);
  });

  test("shows the previous figures alone for an empty period and Tampoco hubo ventas when both are empty", () => {
    const withPrevious = project({ current: [], previous: [september], pendingReports: noReports });
    expect(withPrevious.empty).toBe(true);
    expect(withPrevious.output).toEqual({
      periodo: "Del 01/10/2026 al 31/10/2026", mensaje: "No hay ventas del 01/10/2026 al 31/10/2026.", bloques: [],
      periodo_anterior: ["En el periodo anterior (septiembre de 2026, del 01/09/2026 al 30/09/2026): ventas S/ 600.00, 3 pedidos, ticket promedio S/ 200.00, recibido S/ 500.00."],
    });
    expect(project({ current: [], previous: [], pendingReports: noReports }).output.periodo_anterior).toEqual(["Tampoco hubo ventas en el periodo anterior (del 01/09/2026 al 30/09/2026)."]);
  });

  test("says Tu tienda todavía no tiene pedidos alone for a store without orders", () => {
    const { output, empty } = project({ current: [], previous: [], storeHasOrders: false, pendingReports: noReports });
    expect(empty).toBe(true);
    expect(output).toEqual({ mensaje: "Tu tienda todavía no tiene pedidos.", bloques: [] });
  });

  test("a period with only cancelled orders in a single-currency store answers No hay ventas del … without a currency, then the cancelled lines and the previous period", () => {
    const onlyCancelled = figures({ total: 0, orders: 0, received: money(0), receivedBy: [], cancelled: { orders: 3, total: money(240), confirmed: money(40) } });
    const { output, empty } = project({ current: [onlyCancelled], previous: [september], pendingReports: noReports });
    expect(empty).toBe(true);
    expect(output.mensaje).toBe("No hay ventas del 01/10/2026 al 31/10/2026.");
    expect(output.bloques).toEqual([]);
    expect(output.cancelados).toEqual(["3 pedidos cancelados (S/ 240.00) no cuentan en las ventas.", cancelledMoneyLine]);
    expect(output.periodo_anterior).toHaveLength(1);
  });

  test("orders currency blocks store currency first then by code and opens a block without sales with its currency", () => {
    const usd = figures({ currency: "USD", total: 90, orders: 1, receivedBy: [] , received: money(0, "USD"), owed: money(90, "USD") });
    const eur = figures({ currency: "COP", total: 20, orders: 1 });
    const { output } = project({ current: [eur, usd, october], previous: [] });
    expect(output.bloques.map((block) => block.moneda)).toEqual(["PEN", "COP", "USD"]);
    // October sales only in USD and September sales only in PEN: a PEN block with its September figures alone, never «No hay ventas del …» without a currency.
    const mixed = project({ current: [usd], previous: [september], pendingReports: noReports });
    expect(mixed.empty).toBe(false);
    expect(mixed.output.mensaje).toBeUndefined();
    expect(mixed.output.bloques.map((block) => block.moneda)).toEqual(["PEN", "USD"]);
    expect(mixed.output.bloques[0]).toEqual({
      moneda: "PEN", mensaje: "No hay ventas en PEN del 01/10/2026 al 31/10/2026.",
      comparacion: { encabezado: "En el periodo anterior (septiembre de 2026, del 01/09/2026 al 30/09/2026): ventas S/ 600.00, 3 pedidos, ticket promedio S/ 200.00, recibido S/ 500.00.", lineas: [] },
    });
    expect(mixed.output.bloques[1]!.comparacion!.encabezado).toBe("Sin ventas en el periodo anterior (del 01/09/2026 al 30/09/2026).");
  });

  test("a currency with cancelled orders holding confirmed money and no sales in either window has no block and adds one line after the last block with its currency", () => {
    const usdCancelled = figures({ currency: "USD", total: 0, orders: 0, received: money(0, "USD"), receivedBy: [], cancelled: { orders: 1, total: money(60, "USD"), confirmed: money(40, "USD") } });
    const { output } = project({ current: [october, usdCancelled] });
    expect(output.bloques.map((block) => block.moneda)).toEqual(["PEN"]);
    expect(output.cancelados).toEqual(["En pedidos cancelados en USD hay USD 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web."]);
  });

  test("that line disappears once the confirmed money on the cancelled orders is voided, and is not added for a currency whose cancelled orders hold none", () => {
    const voided = figures({ currency: "USD", total: 0, orders: 0, received: money(0, "USD"), receivedBy: [], cancelled: { orders: 1, total: money(60, "USD"), confirmed: money(0, "USD") } });
    expect(project({ current: [october, voided] }).output).not.toHaveProperty("cancelados");
  });

  test("when no currency has sales the cancelled lines of each currency appear once and the extra line is not repeated", () => {
    const pen = figures({ total: 0, orders: 0, received: money(0), receivedBy: [], cancelled: { orders: 1, total: money(100), confirmed: money(0) } });
    const usd = figures({ currency: "USD", total: 0, orders: 0, received: money(0, "USD"), receivedBy: [], cancelled: { orders: 2, total: money(80, "USD"), confirmed: money(40, "USD") } });
    const { output } = project({ current: [usd, pen], previous: [], pendingReports: noReports });
    expect(output.cancelados).toEqual([
      "1 pedido cancelado en PEN (S/ 100.00) no cuenta en las ventas.",
      "2 pedidos cancelados en USD (USD 80.00) no cuentan en las ventas.",
      "En pedidos cancelados en USD hay USD 40.00 en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.",
    ]);
  });

  test("uses the singular for one report and the plural for several", () => {
    expect(project({ pendingReports: { reports: 3, orders: 2 } }).output.pagos_por_revisar).toBe("3 pagos reportados por revisar, en 2 pedidos. Se aprueban o rechazan en Yoyos.");
    expect(project({ pendingReports: noReports }).output).not.toHaveProperty("pagos_por_revisar");
  });

  test("adds a sales sample with three currency blocks at maximum amounts that fits 24 KB", () => {
    const big = (currency: string) => figures({
      currency, total: 99_999_999_999.99, orders: 99_999, items: money(99_999_999_999.99, currency), deliveryCharges: money(99_999_999_999.99, currency), received: money(99_999_999_999.99, currency),
      owed: money(99_999_999_999.99, currency), overpaid: money(99_999_999_999.99, currency), cancelled: { orders: 99_999, total: money(99_999_999_999.99, currency), confirmed: money(99_999_999_999.99, currency) },
      receivedBy: ["Yape", "Plin", "Transferencia bancaria", "Billetera digital sin especificar"].map((label) => ({ label, amount: money(24_999_999_999.99, currency) })),
    });
    const { output } = project({ current: ["PEN", "USD", "COP"].map(big), previous: ["PEN", "USD", "COP"].map(big), pendingReports: { reports: 99_999, orders: 99_999 } });
    expect(output.bloques).toHaveLength(3);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(24 * 1024);
  });
});
