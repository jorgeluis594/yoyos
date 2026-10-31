import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { limaCalendarDay } from "@shared/orders-date";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import { periodDays, previousPeriod, resolveSalesPeriod, windowOf } from "@core/src/features/assistants/domain/sales-period";
import { toSalesSummaryOutput, type ProjectableFigures, type ProjectableSalesSummary } from "@core/src/features/assistants/domain/sales-projection";
import { day, unknownField } from "@core/src/features/assistants/presentation/tools/input-fields";
import { display } from "@core/src/features/assistants/presentation/display";
import { todayLine } from "@core/src/features/assistants/presentation/tools/orders-texts";
import { periodRefusalMessage } from "@core/src/features/assistants/presentation/tools/sales-texts";

type Window = Readonly<{ from: Date; before: Date }>;
/** The read the tool needs: both windows as Lima midnights, and the days of the period read (the guard decides the too-many-orders text from them). */
export type SalesSummaryRequest = Readonly<{ current: Window; previous: Window; periodDays: number }>;
export type SalesSummaryRead = Readonly<{ summary: ProjectableSalesSummary; storeCurrency: string }>;

/** What the tool needs; `src/composition/assistant-sales-summary-capabilities.ts` binds the sales guard and the orders operations. Failures come back as tool errors with the text to show. */
export type SalesSummaryToolDependencies = Readonly<{
  clock: () => Date;
  summarize: (request: SalesSummaryRequest, access: AssistantAccess) => Promise<Result<SalesSummaryRead, ToolRunError>>;
}>;

const input = z.strictObject({
  desde: day.optional(), hasta: day.optional(),
}, unknownField);

const text = z.string();
const block = z.strictObject({
  moneda: text, mensaje: text.optional(),
  ventas: text.optional(), pedidos: z.number().optional(), ticket_promedio: text.optional(),
  recibido: text.optional(), periodo_abierto: text.optional(), por_medio_de_pago: z.array(text).readonly().optional(), sin_pagos: text.optional(),
  por_cobrar_de_estas_ventas: text.optional(), exceso_recibido: text.optional(),
  cancelados: z.array(text).readonly().optional(),
  comparacion: z.strictObject({ encabezado: text, lineas: z.array(text).readonly() }).optional(),
});
const output = z.strictObject({
  hoy: text, periodo: text.optional(), significado: text.optional(), mensaje: text.optional(),
  bloques: z.array(block).readonly(),
  pagos_por_revisar: text.optional(), cancelados: z.array(text).readonly().optional(), periodo_anterior: z.array(text).readonly().optional(),
});
type SalesSummaryAnswer = z.output<typeof output>;

export const salesSummaryDescription = [
  "Resume las ventas de la tienda en un periodo y las compara con el periodo anterior. Úsala para «¿cómo me fue este mes?», «¿cuánto me pagaron por Yape de lo que vendí?» o «¿cuál es mi ticket promedio?». Nunca sumes páginas de pedidos.",
  "desde y hasta: AAAA-MM-DD, días completos en hora de Lima con ambos extremos incluidos; son la fecha de creación del pedido, la misma que creado_desde y creado_hasta de buscar_pedidos, nunca la de despacho, entrega o pago. Sin fechas lee desde el 1 del mes actual hasta hoy; con solo desde, hasta hoy; solo hasta se rechaza. Un hasta futuro se lee hasta hoy y el resultado lo dice. El periodo puede tener hasta 366 días; si es demasiado grande para leerlo de una vez pide uno más corto, por ejemplo un mes.",
  "Ventas son los pedidos no cancelados creados en el periodo, pagados o no, de cualquier origen: productos (subtotales de los ítems) más envíos (lo que paga el comprador, nunca el costo interno). Ticket promedio es ventas entre pedidos. Recibido son los pagos confirmados de esas ventas, aunque se confirmaran después: no es lo que entró a la cuenta en esas fechas. Por cobrar de estas ventas es lo que aún deben solo estas ventas, no todo lo que te deben; Exceso recibido es lo pagado de más. Ventas = Recibido + Por cobrar − Exceso recibido.",
  "Por medio de pago reparte lo recibido: Yape y Plin son los proveedores de lo que pedidos y ver_pedido muestran como «Billetera digital»; «Billetera digital sin especificar» es un pago de billetera sin proveedor. Los porcentajes se redondean uno por uno y pueden sumar 99% o 101%: no los ajustes.",
  "La comparación con el periodo anterior viene calculada: cada línea nombra la cifra de este periodo, la del anterior y si es más o menos; no la recalcules ni la inviertas. Si el periodo llega hasta hoy sigue abierto: su recibido puede subir mientras se pagan sus ventas.",
  "Los pedidos cancelados no cuentan; si guardan pagos confirmados el resumen lo avisa, y para devolver ese dinero hay que anular esos pagos en Yoyos desde la web, no desde el agente. «Pagos por revisar» cuenta reportes de compradores que el dueño aprueba o rechaza en Yoyos.",
  "Siguientes pasos: para ver los pedidos detrás de «Por cobrar» usa buscar_pedidos con pago «por cobrar» y creado_desde y creado_hasta del periodo leído; para todo lo que te deben, de cualquier fecha, pedidos_por_cobrar; para los pedidos con un pago por revisar, buscar_pedidos con las mismas fechas y sin pago. Para lo más vendido usa lo_mas_vendido y para lo que no se vende productos_sin_ventas, con las mismas fechas.",
  "Cada moneda trae su propio bloque completo; nunca sumes monedas distintas.",
].join(" ");

/** The 24 KB worst case: three currency blocks at maximum amounts and counts, each with a comparison, plus the reports and the cancelled lines of a fourth currency. */
function sampleOutput(): SalesSummaryAnswer {
  const big = (code: string): ProjectableFigures => {
    const money = (amount: number) => ({ amount, currency: code });
    return {
      currency: code, orders: 99_999, items: money(99_999_999_999.99), deliveryCharges: money(99_999_999_999.99), total: money(99_999_999_999.99), received: money(99_999_999_999.99),
      owed: money(99_999_999_999.99), overpaid: money(99_999_999_999.99), cancelled: { orders: 99_999, total: money(99_999_999_999.99), confirmed: money(99_999_999_999.99) },
      receivedBy: ["Yape", "Plin", "Transferencia bancaria", "Billetera digital sin especificar"].map((label) => ({ label, amount: money(24_999_999_999.99) })),
    };
  };
  const codes = ["PEN", "USD", "COP"];
  const brlCancelled = { ...big("BRL"), orders: 0, received: { amount: 0, currency: "BRL" }, receivedBy: [] };
  const period = { from: "2026-01-01", through: "2026-10-30", cutToToday: true };
  const { output: projected } = toSalesSummaryOutput(
    { current: [...codes.map(big), brlCancelled], previous: codes.map(big), pendingReports: { reports: 99_999, orders: 99_999 }, storeHasOrders: true },
    { display, period, previous: previousPeriod(period), today: "2026-10-30", storeCurrency: "PEN" },
  );
  return { hoy: todayLine("30/10/2026"), ...projected };
}

export function createSalesSummaryTool(deps: SalesSummaryToolDependencies): RegisteredTool<z.output<typeof input>, SalesSummaryAnswer> {
  return {
    name: "resumen_de_ventas", title: "Resumen de ventas", description: salesSummaryDescription, inputSchema: input, outputSchema: output, sampleOutputs: [sampleOutput()],
    async run(raw, access): Promise<ToolRun<SalesSummaryAnswer>> {
      const today = limaCalendarDay(deps.clock());
      const period = resolveSalesPeriod(raw, today);
      if (!period.success) return err({ code: "INVALID_INPUT", message: periodRefusalMessage(period.error) });
      const previous = previousPeriod(period.data);
      const read = await deps.summarize({ current: windowOf(period.data), previous: windowOf(previous), periodDays: periodDays(period.data) }, access);
      if (!read.success) return read;
      const { output: projected, empty } = toSalesSummaryOutput(read.data.summary, { display, period: period.data, previous, today, storeCurrency: read.data.storeCurrency });
      return ok({ output: { hoy: todayLine(display.day(today)), ...projected }, empty });
    },
  };
}
