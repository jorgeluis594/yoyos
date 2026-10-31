import type { Display } from "@core/src/features/assistants/domain/order-projection";
import type { PreviousPeriod, SalesPeriod } from "@core/src/features/assistants/domain/sales-period";
import { averageCents, centsOf, compareAverages, compareFigure, counted, sharePercent, type Comparison, type Share } from "@core/src/features/assistants/domain/sales-figures";

type Money = Readonly<{ amount: number; currency: string }>;

/** The figures of one currency in one window, as the orders feature computed them; the assistants domain imports nothing from orders. */
export type ProjectableFigures = Readonly<{
  currency: string;
  orders: number; items: Money; deliveryCharges: Money; total: Money;
  received: Money; owed: Money; overpaid: Money;
  receivedBy: readonly Readonly<{ label: string; amount: Money }>[];
  cancelled: Readonly<{ orders: number; total: Money; confirmed: Money }>;
}>;
export type ProjectableSalesSummary = Readonly<{
  current: readonly ProjectableFigures[]; previous: readonly ProjectableFigures[];
  pendingReports: Readonly<{ reports: number; orders: number }>;
  storeHasOrders: boolean;
}>;
export type SalesSummaryContext = Readonly<{
  display: Display; period: SalesPeriod; previous: PreviousPeriod;
  today: string;               // `AAAA-MM-DD` in Lima
  storeCurrency: string;
}>;

export type SalesBlockOutput = Readonly<{
  moneda: string;
  mensaje?: string;
  ventas?: string; pedidos?: number; ticket_promedio?: string;
  recibido?: string; periodo_abierto?: string; por_medio_de_pago?: readonly string[]; sin_pagos?: string;
  por_cobrar_de_estas_ventas?: string; exceso_recibido?: string;
  cancelados?: readonly string[];
  comparacion?: Readonly<{ encabezado: string; lineas: readonly string[] }>;
}>;
export type SalesSummaryOutput = Readonly<{
  periodo?: string; significado?: string; mensaje?: string;
  bloques: readonly SalesBlockOutput[];
  pagos_por_revisar?: string;
  cancelados?: readonly string[];
  periodo_anterior?: readonly string[];
}>;

const meaningLine = "Ventas son los pedidos registrados en estas fechas, pagados o no. Recibido son los pagos confirmados de esas ventas, aunque se confirmaran después: no es lo que entró a tu cuenta en estas fechas. Por cobrar es lo que aún deben estas ventas, no todo lo que te deben.";
const openPeriodLine = "Este periodo sigue abierto: su recibido puede subir mientras se pagan sus ventas.";
const noPaymentsLine = "Todavía no hay pagos confirmados de estas ventas.";
const noOrdersLine = "Tu tienda todavía no tiene pedidos.";
const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const sales = (entry: ProjectableFigures | undefined): entry is ProjectableFigures => entry !== undefined && entry.orders > 0;
const shareText = (share: Share) => (share.kind === "under_one" ? "menos de 1%" : `${share.value}%`);
const cancelledMoneyLine = (money: string, scope: string) => `En pedidos cancelados${scope} hay ${money} en pagos confirmados. Si devolviste ese dinero, anula esos pagos en Yoyos desde la web.`;

/** Store currency first, then the others by code A–Z. */
const byCurrency = (storeCurrency: string) => (a: string, b: string) => (a === storeCurrency ? -1 : b === storeCurrency ? 1 : a.localeCompare(b));

export function toSalesSummaryOutput(summary: ProjectableSalesSummary, context: SalesSummaryContext): Readonly<{ output: SalesSummaryOutput; empty: boolean }> {
  const { display, period, previous, today } = context;
  if (!summary.storeHasOrders) return { output: { mensaje: noOrdersLine, bloques: [] }, empty: true };
  const day = display.day;
  const dates = (range: Readonly<{ from: string; through: string }>) => `del ${day(range.from)} al ${day(range.through)}`;
  const named = previous.month === null ? dates(previous) : `${monthNames[previous.month.month - 1]} de ${previous.month.year}, ${dates(previous)}`;
  const money = (cents: number, currency: string) => display.money({ amount: cents / 100, currency });
  const moneyOf = (value: Money) => display.money(value);
  const periodo = `Del ${day(period.from)} al ${day(period.through)}${period.cutToToday ? " (hasta hoy)" : ""}`;
  const compare = byCurrency(context.storeCurrency);

  const currentOf = (code: string) => summary.current.find((entry) => entry.currency === code);
  const previousOf = (code: string) => summary.previous.find((entry) => entry.currency === code);
  const withSales = (entries: readonly ProjectableFigures[]) => entries.filter(sales).map((entry) => entry.currency);
  const reports = summary.pendingReports.reports > 0
    ? { pagos_por_revisar: `${counted(summary.pendingReports.reports, "pago reportado", "pagos reportados")} por revisar, en ${counted(summary.pendingReports.orders, "pedido", "pedidos")}. ${summary.pendingReports.reports === 1 ? "Se aprueba o rechaza" : "Se aprueban o rechazan"} en Yoyos.` }
    : {};

  /** «ventas S/ 600.00, 3 pedidos, ticket promedio S/ 200.00, recibido S/ 500.00»: the figures of a window shown alone, without differences. */
  const figuresAlone = (entry: ProjectableFigures) =>
    `ventas ${moneyOf(entry.total)}, ${counted(entry.orders, "pedido", "pedidos")}, ticket promedio ${money(averageCents(centsOf(entry.total), entry.orders), entry.currency)}, recibido ${moneyOf(entry.received)}`;

  /** The cancelled lines of one currency; `scope` is the currency code (« en USD») when the answer has to name it. */
  const cancelledLines = (entry: ProjectableFigures, scope: string): string[] => {
    if (entry.cancelled.orders === 0) return [];
    const plural = entry.cancelled.orders !== 1;
    const lines = [`${counted(entry.cancelled.orders, "pedido cancelado", "pedidos cancelados")}${scope} (${moneyOf(entry.cancelled.total)}) ${plural ? "no cuentan" : "no cuenta"} en las ventas.`];
    if (centsOf(entry.cancelled.confirmed) > 0) lines.push(cancelledMoneyLine(moneyOf(entry.cancelled.confirmed), scope));
    return lines;
  };

  if (withSales(summary.current).length === 0) {
    const cancelled = summary.current.filter((entry) => entry.cancelled.orders > 0).sort((a, b) => compare(a.currency, b.currency));
    const lines = cancelled.flatMap((entry) => cancelledLines(entry, cancelled.length > 1 ? ` en ${entry.currency}` : ""));
    const before = summary.previous.filter(sales).sort((a, b) => compare(a.currency, b.currency));
    const periodoAnterior = before.length === 0
      ? [`Tampoco hubo ventas en el periodo anterior (${dates(previous)}).`]
      : before.map((entry) => `En el periodo anterior (${named})${before.length > 1 ? ` en ${entry.currency}` : ""}: ${figuresAlone(entry)}.`);
    return { output: { periodo, mensaje: `No hay ventas ${dates(period)}.`, bloques: [], ...(lines.length > 0 ? { cancelados: lines } : {}), periodo_anterior: periodoAnterior }, empty: true };
  }

  const comparison = (now: ProjectableFigures, before: ProjectableFigures): SalesBlockOutput["comparacion"] => {
    const wording = (result: Comparison, format: (amount: number) => string) => {
      if (result.kind === "same") return "igual que en el anterior";
      const sign = result.kind === "more" ? "+" : "−";
      const percent = result.percent === null ? "" : ` (${result.percent === "under_one" ? "menos de 1%" : `${sign}${result.percent}%`})`;
      return `${format(result.difference)} ${result.kind === "more" ? "más" : "menos"} que en el anterior${percent}`;
    };
    const cents = (value: Money) => centsOf(value);
    const line = (label: string, current: string, earlier: string, result: Comparison, format: (amount: number) => string) =>
      `${label}: ${current} en este periodo y ${earlier} en el anterior: ${wording(result, format)}.`;
    const asMoney = (amount: number) => money(amount, now.currency);
    const average = (entry: ProjectableFigures) => averageCents(cents(entry.total), entry.orders);
    return {
      encabezado: `Comparado con el periodo anterior (${named}):`,
      lineas: [
        line("Ventas", moneyOf(now.total), moneyOf(before.total), compareFigure(cents(now.total), cents(before.total)), asMoney),
        line("Pedidos", String(now.orders), String(before.orders), compareFigure(now.orders, before.orders), String),
        line("Ticket promedio", asMoney(average(now)), asMoney(average(before)),
          compareAverages({ totalCents: cents(now.total), orders: now.orders }, { totalCents: cents(before.total), orders: before.orders }), asMoney),
        line("Recibido", moneyOf(now.received), moneyOf(before.received), compareFigure(cents(now.received), cents(before.received)), asMoney),
      ],
    };
  };

  const blockOf = (code: string): SalesBlockOutput => {
    const now = currentOf(code), before = previousOf(code);
    const earlier = sales(before) ? before : undefined;
    if (!sales(now)) {
      const cancelled = now ? cancelledLines(now, "") : [];
      return {
        moneda: code, mensaje: `No hay ventas en ${code} ${dates(period)}.`, ...(cancelled.length > 0 ? { cancelados: cancelled } : {}),
        comparacion: { encabezado: `En el periodo anterior (${named}): ${figuresAlone(earlier!)}.`, lineas: [] },
      };
    }
    const received = centsOf(now.received);
    const methods = new Map<string, number>();
    for (const method of now.receivedBy) methods.set(method.label, (methods.get(method.label) ?? 0) + centsOf(method.amount));
    const listed = [...methods].sort(([labelA, a], [labelB, b]) => b - a || labelA.localeCompare(labelB, "es")).map(([label, cents]) => `${label}: ${money(cents, code)} (${shareText(sharePercent(cents, received))})`);
    const cancelled = cancelledLines(now, "");
    return {
      moneda: code,
      ventas: `${moneyOf(now.total)} (productos ${moneyOf(now.items)}, envíos ${moneyOf(now.deliveryCharges)})`,
      pedidos: now.orders, ticket_promedio: money(averageCents(centsOf(now.total), now.orders), code),
      recibido: moneyOf(now.received), ...(period.through === today ? { periodo_abierto: openPeriodLine } : {}),
      ...(received > 0 && listed.length > 0 ? { por_medio_de_pago: listed } : { sin_pagos: noPaymentsLine }),
      por_cobrar_de_estas_ventas: moneyOf(now.owed), ...(centsOf(now.overpaid) > 0 ? { exceso_recibido: moneyOf(now.overpaid) } : {}),
      ...(cancelled.length > 0 ? { cancelados: cancelled } : {}),
      comparacion: earlier ? comparison(now, earlier) : { encabezado: `Sin ventas en el periodo anterior (${dates(previous)}).`, lineas: [] },
    };
  };

  const blockCurrencies = [...new Set([...withSales(summary.current), ...withSales(summary.previous)])].sort(compare);
  // A currency without a block whose cancelled orders still hold confirmed money gets one line after the last block.
  const orphans = summary.current.filter((entry) => !blockCurrencies.includes(entry.currency) && centsOf(entry.cancelled.confirmed) > 0).sort((a, b) => compare(a.currency, b.currency))
    .map((entry) => cancelledMoneyLine(moneyOf(entry.cancelled.confirmed), ` en ${entry.currency}`));
  return {
    output: { periodo, significado: meaningLine, bloques: blockCurrencies.map(blockOf), ...reports, ...(orphans.length > 0 ? { cancelados: orphans } : {}) },
    empty: false,
  };
}
