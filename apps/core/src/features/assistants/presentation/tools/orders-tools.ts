import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { limaCalendarDay, limaMidnightUtc, nextCalendarDay } from "@shared/orders-date";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { RegisteredTool, ToolRun, ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import type { ToolModule } from "@core/src/features/assistants/presentation/tool-module";
import {
  maxCombination, maxProductName, maxRejectionReason, toAssistantDispatchEntry, toAssistantOrder, toAssistantOrderSummary,
  type AssistantDispatchEntry, type AssistantOrder, type AssistantOrderSummary, type Display, type DispatchStockState, type ProjectableOrder, type ProjectableReadiness, type ProjectionContext,
} from "@core/src/features/assistants/domain/order-projection";
import { display as defaultDisplay } from "@core/src/features/assistants/presentation/display";
import {
  ambiguousCourierMessage, dateFormatMessage, dispatchSummaryLine, dispatchTodayDescription, moreLine, noDispatchMessage, noMatchesMessage, noOrderMessage, noOrdersMessage,
  noUnpaidMessage, orderToolsInstructions, pendingReportsLine, readinessText, reversedRangeMessage, searchOrdersDescription, todayLine, undatedLine,
  unknownCourierMessage, unpaidOrdersDescription, unpaidSummaryLine, viewOrderDescription,
} from "@core/src/features/assistants/presentation/tools/orders-texts";

const pageSize = 20;
type Money = Readonly<{ amount: number; currency: string }>;
type Failure = ToolRunError;
type Read<T> = Promise<Result<T, Failure>>;

export type SearchOrdersQuery = Readonly<{
  page: number; search?: string; view?: "unpaid" | "paid"; excludeCancelled: boolean; deliveryStatus?: "pending" | "shipped" | "delivered"; courierId?: string;
  createdFrom?: Date; createdBefore?: Date; shippedFrom?: Date; shippedBefore?: Date;
  scheduled: Readonly<{ from?: string; through?: string; unscheduled: boolean }>;
}>;
type OrderPage = Readonly<{ items: readonly ProjectableOrder[]; page: number; total: number }>;
export type DispatchQueueRead = Readonly<{
  entries: readonly Readonly<{ group: "overdue" | "today"; order: ProjectableOrder; readiness: ProjectableReadiness }>[];
  page: number; total: number; summary: Readonly<{ overdue: number; overdueReady: number; today: number; todayReady: number }>; undatedPending: number;
}>;

/** What the order tools need of the orders feature; `src/composition/assistant-order-capabilities.ts` wires the composed operations. Refusals come back as tool errors. */
export type OrderToolsDependencies = Readonly<{
  clock: () => Date;
  link: (orderId: string) => string;
  listOrders: (query: SearchOrdersQuery, access: AssistantAccess) => Read<OrderPage>;
  hasAnyOrder: (access: AssistantAccess) => Read<boolean>;
  listCouriers: (access: AssistantAccess) => Read<readonly Readonly<{ id: string; name: string }>[]>;
  findOrder: (number: number, access: AssistantAccess) => Read<Readonly<{ order: ProjectableOrder; stock: DispatchStockState; readiness: ProjectableReadiness | null }>>;
  summarizeUnpaid: (access: AssistantAccess) => Read<Readonly<{ count: number; withPendingReport: number; owed: readonly Money[] }>>;
  listDispatchQueue: (today: string, page: number, access: AssistantAccess) => Read<DispatchQueueRead>;
}>;

const day = z.string({ error: dateFormatMessage }).regex(/^\d{4}-\d{2}-\d{2}$/, dateFormatMessage).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), dateFormatMessage);
const page = z.number({ error: "La página debe ser un número entero." }).int("La página debe ser un número entero.").min(1, "La página empieza en 1.").default(1);

// Zod words an unknown field in English; the agent gets Spanish, like every other text.
const unknownField = { error: (issue: { code: string; keys?: string[] }) => issue.code === "unrecognized_keys" ? `No existe el campo ${(issue.keys ?? []).join(", ")}. Usa solo los campos de la herramienta.` : undefined };
const searchInput = z.strictObject({
  texto: z.string({ error: "texto debe ser un texto." }).trim().max(120, "texto admite como máximo 120 caracteres.").optional(),
  pago: z.enum(["por cobrar", "pagado"], { error: 'pago admite "por cobrar" o "pagado".' }).optional(),
  entrega: z.enum(["pendiente", "despachada", "entregada"], { error: 'entrega admite "pendiente", "despachada" o "entregada".' }).optional(),
  incluir_cancelados: z.boolean({ error: "incluir_cancelados debe ser true o false." }).default(false),
  courier: z.string({ error: "courier debe ser un texto." }).trim().min(1, "courier no puede estar vacío.").max(80, "courier admite como máximo 80 caracteres.").optional(),
  creado_desde: day.optional(), creado_hasta: day.optional(), despacho_programado_desde: day.optional(), despacho_programado_hasta: day.optional(),
  sin_fecha_de_despacho: z.boolean({ error: "sin_fecha_de_despacho debe ser true o false." }).optional(), despachado_desde: day.optional(), despachado_hasta: day.optional(), pagina: page,
}, unknownField);
const viewInput = z.strictObject({ numero: z.string({ error: "Indica el número del pedido, por ejemplo 1001 o #1001." }).trim().regex(/^#?\d{1,9}$/, "Indica el número del pedido, por ejemplo 1001 o #1001.") }, unknownField);
const pageInput = z.strictObject({ pagina: page }, unknownField);

const text = z.string();
const summarySchema = z.strictObject({
  numero: text, creado: text, cliente: text, origen: z.enum(["Desde el catálogo", "WhatsApp", "Venta manual"]), total: text, recibido: text,
  estado_pago: z.enum(["Pagado", "Pago pendiente"]), por_cobrar: text.optional(), pago_por_revisar: z.literal(true).optional(), estado: z.enum(["Cancelado", "Completado"]).optional(),
  estado_entrega: z.enum(["Pendiente", "Despachada", "Entregada"]), modalidad: z.enum(["A domicilio", "Agencia", "Recojo en tienda", "Por definir"]),
  courier: text.optional(), despacho_programado: text.optional(), enlace: text,
}) satisfies z.ZodType<AssistantOrderSummary>;
const readinessSchema = z.strictObject({ listo: z.boolean(), texto: text });
const orderSchema = summarySchema.extend({
  despachado: text.optional(), entregado: text.optional(),
  productos: z.array(z.strictObject({ producto: text, combinacion: text.optional(), cantidad: z.number(), precio_unitario: text, subtotal: text, precio_mencionado: text.optional() })).readonly(),
  total_productos: text, entrega_cobrada: text.optional(), sobrepago: text.optional(),
  pagos: z.array(z.strictObject({
    estado: z.enum(["Confirmado", "Por revisar", "Rechazado", "Anulado"]), fecha: text, monto: text.optional(), metodo: z.enum(["Billetera digital", "Transferencia bancaria"]).optional(),
    con_comprobante: z.literal(true).optional(), motivo: text.optional(),
  })).readonly(),
  entrega: z.strictObject({
    modalidad: z.enum(["A domicilio", "Agencia", "Recojo en tienda", "Por definir"]), destino: text, courier: text.optional(), destinatario: text.optional(),
    telefono: text.optional(), punto_de_recojo: text.optional(),
  }),
  stock: z.enum(["Esperando stock", "Descontando stock"]).optional(), preparacion: readinessSchema.optional(),
}) satisfies z.ZodType<AssistantOrder>;
const dispatchEntrySchema = z.strictObject({
  grupo: z.enum(["Atrasados", "Para hoy"]), numero: text, cliente: text, modalidad: z.enum(["A domicilio", "Agencia", "Recojo en tienda", "Por definir"]), courier: text.optional(),
  punto_de_recojo: text.optional(), destino: text, despacho_programado: text, estado_pago: z.enum(["Pagado", "Pago pendiente"]), por_cobrar: text.optional(),
  pago_por_revisar: z.literal(true).optional(), preparacion: readinessSchema, enlace: text,
}) satisfies z.ZodType<AssistantDispatchEntry>;

const listFrame = { hoy: text, pagina: z.number(), total: z.number(), hay_mas: text.optional(), mensaje: text.optional() };
const searchOutput = z.strictObject({ ...listFrame, pedidos: z.array(summarySchema) });
const unpaidOutput = z.strictObject({ ...listFrame, resumen: text.optional(), pedidos: z.array(summarySchema) });
const dispatchOutput = z.strictObject({ ...listFrame, resumen: text.optional(), sin_fecha_de_despacho: text.optional(), pedidos: z.array(dispatchEntrySchema) });
const orderOutput = orderSchema;

const invalid = (message: string): Failure => ({ code: "INVALID_INPUT", message });
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

type CourierChoice = Result<string, Failure>;
function chooseCourier(name: string, couriers: readonly Readonly<{ id: string; name: string }>[]): CourierChoice {
  const wanted = normalize(name);
  const exact = couriers.filter((courier) => normalize(courier.name) === wanted);
  if (exact.length === 1) return ok(exact[0]!.id);
  const partial = exact.length > 1 ? exact : couriers.filter((courier) => normalize(courier.name).includes(wanted));
  if (partial.length === 1) return ok(partial[0]!.id);
  return err(invalid(partial.length === 0 ? unknownCourierMessage(name, couriers.map((courier) => courier.name)) : ambiguousCourierMessage(name, partial.map((courier) => courier.name))));
}

type Range = Result<Readonly<{ from?: string; through?: string }>, Failure>;
const rangeOf = (label: string, from: string | undefined, through: string | undefined): Range =>
  from !== undefined && through !== undefined && through < from ? err(invalid(reversedRangeMessage(label, from, through))) : ok({ from, through });
const startOf = (value: string | undefined) => (value === undefined ? undefined : new Date(limaMidnightUtc(value)));
const endOf = (value: string | undefined) => (value === undefined ? undefined : new Date(limaMidnightUtc(nextCalendarDay(value))));

const hasMore = (current: number, total: number) => (current * pageSize < total ? moreLine(current + 1) : undefined);
const withMore = (current: number, total: number) => { const more = hasMore(current, total); return more ? { hay_mas: more } : {}; };

type SearchInput = z.output<typeof searchInput>;
const deliveryStates = { pendiente: "pending", despachada: "shipped", entregada: "delivered" } as const;

/** Whether the agent narrowed the search: an empty answer to a narrowed search may still belong to a store with orders. */
const hasFilters = (input: SearchInput): boolean => input.texto !== undefined && input.texto !== "" || input.sin_fecha_de_despacho === true
  || [input.pago, input.entrega, input.courier, input.creado_desde, input.creado_hasta, input.despacho_programado_desde, input.despacho_programado_hasta,
    input.despachado_desde, input.despachado_hasta].some((value) => value !== undefined);

function queryOf(input: SearchInput, courierId: string | undefined): SearchOrdersQuery {
  const createdFrom = startOf(input.creado_desde), createdBefore = endOf(input.creado_hasta);
  const shippedFrom = startOf(input.despachado_desde), shippedBefore = endOf(input.despachado_hasta);
  return {
    page: input.pagina, excludeCancelled: !input.incluir_cancelados,
    ...(input.texto ? { search: input.texto } : {}), ...(input.pago ? { view: input.pago === "pagado" ? "paid" as const : "unpaid" as const } : {}),
    ...(input.entrega ? { deliveryStatus: deliveryStates[input.entrega] } : {}), ...(courierId ? { courierId } : {}),
    ...(createdFrom ? { createdFrom } : {}), ...(createdBefore ? { createdBefore } : {}), ...(shippedFrom ? { shippedFrom } : {}), ...(shippedBefore ? { shippedBefore } : {}),
    scheduled: { ...(input.despacho_programado_desde ? { from: input.despacho_programado_desde } : {}), ...(input.despacho_programado_hasta ? { through: input.despacho_programado_hasta } : {}),
      unscheduled: input.sin_fecha_de_despacho === true },
  };
}

export type OrderToolsOptions = Readonly<{ display?: Display }>;

export function createOrderToolsModule(deps: OrderToolsDependencies, options: OrderToolsOptions = {}): ToolModule {
  const display = options.display ?? defaultDisplay;
  const context: ProjectionContext = { display, link: deps.link, readinessText };
  const today = () => display.day(limaCalendarDay(deps.clock()));

  const searchOrders: RegisteredTool<z.output<typeof searchInput>, z.output<typeof searchOutput>> = {
    name: "buscar_pedidos", title: "Buscar pedidos", description: searchOrdersDescription, inputSchema: searchInput, outputSchema: searchOutput,
    sampleOutputs: [sampleSearchOutput(20, 1)],
    async run(input, access): Promise<ToolRun<z.output<typeof searchOutput>>> {
      const created = rangeOf("", input.creado_desde, input.creado_hasta);
      if (!created.success) return created;
      const scheduled = rangeOf("Despacho programado", input.despacho_programado_desde, input.despacho_programado_hasta);
      if (!scheduled.success) return scheduled;
      const shipped = rangeOf("Despachado", input.despachado_desde, input.despachado_hasta);
      if (!shipped.success) return shipped;
      if (input.sin_fecha_de_despacho && (input.despacho_programado_desde || input.despacho_programado_hasta)) {
        return err(invalid("sin_fecha_de_despacho no se combina con un rango de despacho programado."));
      }
      let courierId: string | undefined;
      if (input.courier !== undefined) {
        const couriers = await deps.listCouriers(access);
        if (!couriers.success) return couriers;
        const chosen = chooseCourier(input.courier, couriers.data.toSorted((a, b) => a.name.localeCompare(b.name, "es")));
        if (!chosen.success) return chosen;
        courierId = chosen.data;
      }
      const read = await deps.listOrders(queryOf(input, courierId), access);
      if (!read.success) return read;
      const frame = { hoy: todayLine(today()), pagina: read.data.page, total: read.data.total };
      if (read.data.items.length === 0 && read.data.total === 0) {
        const any = hasFilters(input) ? await deps.hasAnyOrder(access) : ok(false);
        if (!any.success) return any;
        return ok({ output: { ...frame, mensaje: any.data ? noMatchesMessage : noOrdersMessage, pedidos: [] }, empty: true });
      }
      return ok({ output: { ...frame, ...withMore(read.data.page, read.data.total), pedidos: read.data.items.map((order) => toAssistantOrderSummary(order, context)) }, empty: false });
    },
  };

  const viewOrder: RegisteredTool<z.output<typeof viewInput>, z.output<typeof orderOutput>> = {
    name: "ver_pedido", title: "Ver pedido", description: viewOrderDescription, inputSchema: viewInput, outputSchema: orderOutput,
    sampleOutputs: [sampleOrderOutput(60, 10)],
    async run(input, access) {
      const number = Number(input.numero.replace("#", ""));
      const found = await deps.findOrder(number, access);
      if (!found.success) return found.error.code === "NOT_FOUND" ? err({ code: "NOT_FOUND", message: noOrderMessage(number) }) : found;
      return ok({ output: toAssistantOrder(found.data.order, found.data.stock, found.data.readiness, context), empty: false });
    },
  };

  const unpaidOrders: RegisteredTool<z.output<typeof pageInput>, z.output<typeof unpaidOutput>> = {
    name: "pedidos_por_cobrar", title: "Pedidos por cobrar", description: unpaidOrdersDescription, inputSchema: pageInput, outputSchema: unpaidOutput,
    sampleOutputs: [sampleUnpaidOutput(20)],
    async run(input, access) {
      const [summary, orders] = await Promise.all([deps.summarizeUnpaid(access), deps.listOrders({ page: input.pagina, view: "unpaid", excludeCancelled: true, scheduled: { unscheduled: false } }, access)]);
      if (!summary.success) return summary;
      if (!orders.success) return orders;
      const frame = { hoy: todayLine(today()), pagina: orders.data.page, total: orders.data.total };
      if (summary.data.count === 0 && orders.data.total === 0) return ok({ output: { ...frame, mensaje: noUnpaidMessage, pedidos: [] }, empty: true });
      const owed = summary.data.owed.map((money) => display.money(money)).join(" y ");
      const reports = summary.data.withPendingReport > 0 ? `. ${pendingReportsLine(summary.data.withPendingReport)}` : "";
      return ok({ output: { ...frame, resumen: `${unpaidSummaryLine(summary.data.count, owed)}${reports}`, ...withMore(orders.data.page, orders.data.total),
        pedidos: orders.data.items.map((order) => toAssistantOrderSummary(order, context)) }, empty: false });
    },
  };

  const dispatchToday: RegisteredTool<z.output<typeof pageInput>, z.output<typeof dispatchOutput>> = {
    name: "pedidos_por_despachar_hoy", title: "Pedidos por despachar hoy", description: dispatchTodayDescription, inputSchema: pageInput, outputSchema: dispatchOutput,
    sampleOutputs: [sampleDispatchOutput(20)],
    async run(input, access) {
      const queue = await deps.listDispatchQueue(limaCalendarDay(deps.clock()), input.pagina, access);
      if (!queue.success) return queue;
      const { data } = queue;
      const frame = { hoy: todayLine(today()), pagina: data.page, total: data.total };
      const undated = data.undatedPending > 0 ? { sin_fecha_de_despacho: undatedLine(data.undatedPending) } : {};
      if (data.total === 0) return ok({ output: { ...frame, mensaje: noDispatchMessage, ...undated, pedidos: [] }, empty: true });
      return ok({ output: { ...frame, resumen: dispatchSummaryLine(data.summary), ...withMore(data.page, data.total), ...undated,
        pedidos: data.entries.map((entry) => toAssistantDispatchEntry(entry.order, entry.group, entry.readiness, context)) }, empty: false });
    },
  };

  return { scope: "orders:read", access: "read", instructions: orderToolsInstructions, tools: [searchOrders, viewOrder, unpaidOrders, dispatchToday] };
}

// Sample outputs for the static validator: maximum-length texts, so the 24 KB budget is checked on realistic worst cases.
const long = (length: number, seed = "x") => seed.repeat(length).slice(0, length);
function sampleSummary(index: number): AssistantOrderSummary {
  return {
    numero: `#${1000 + index}`, creado: "30/10/2026", cliente: long(200, "Ana "), origen: "Desde el catálogo", total: "S/ 99,999,999.00", recibido: "S/ 99,999,999.00", estado_pago: "Pago pendiente",
    por_cobrar: "S/ 99,999,999.00", pago_por_revisar: true, estado: "Completado", estado_entrega: "Pendiente", modalidad: "Agencia", courier: long(80, "Olva "),
    despacho_programado: "30/10/2026", enlace: `https://app.yoyos.lat/orders/${"0123456789abcdef".repeat(2).slice(0, 8)}-0000-4000-8000-000000000000`,
  };
}
function sampleSearchOutput(count: number, pageNumber: number): z.output<typeof searchOutput> {
  return { hoy: "Hoy es 30/10/2026", pagina: pageNumber, total: count + 1, hay_mas: "hay más: pide la página 2", pedidos: Array.from({ length: count }, (_, index) => sampleSummary(index)) };
}
function sampleUnpaidOutput(count: number): z.output<typeof unpaidOutput> {
  return { ...sampleSearchOutput(count, 1), resumen: "12 pedidos, S/ 99,999,999.00 por cobrar. 12 tienen un pago por revisar" };
}
function sampleDispatchOutput(count: number): z.output<typeof dispatchOutput> {
  return {
    hoy: "Hoy es 30/10/2026", pagina: 1, total: count + 1, hay_mas: "hay más: pide la página 2", resumen: dispatchSummaryLine({ overdue: 99, overdueReady: 99, today: 99, todayReady: 99 }),
    sin_fecha_de_despacho: undatedLine(9999),
    pedidos: Array.from({ length: count }, (_, index) => ({
      grupo: "Atrasados" as const, numero: `#${1000 + index}`, cliente: long(200, "Ana "), modalidad: "Agencia" as const, courier: long(80, "Olva "), destino: long(300, "Calle "),
      despacho_programado: "28/10/2026", estado_pago: "Pago pendiente" as const, por_cobrar: "S/ 99,999,999.00", pago_por_revisar: true as const,
      preparacion: { listo: false, texto: `Para despachar falta stock de ${long(120, "Camisa (M · Azul), ")}.` }, enlace: sampleSummary(index).enlace,
    })),
  };
}
function sampleOrderOutput(itemCount: number, paymentCount: number): z.output<typeof orderOutput> {
  return {
    ...sampleSummary(1), despachado: "30/10/2026 10:42", entregado: "30/10/2026 10:42", total_productos: "S/ 99,999,999.00", entrega_cobrada: "S/ 99,999,999.00", sobrepago: "S/ 99,999,999.00",
    productos: Array.from({ length: itemCount }, () => ({
      producto: long(maxProductName, "Camisa "), combinacion: long(maxCombination, "M · Azul "), cantidad: 99999, precio_unitario: "S/ 99,999,999.00", subtotal: "S/ 99,999,999.00", precio_mencionado: "S/ 99,999,999.00 por 99999",
    })),
    pagos: Array.from({ length: paymentCount }, () => ({
      estado: "Rechazado" as const, fecha: "30/10/2026 10:42", monto: "S/ 99,999,999.00", metodo: "Transferencia bancaria" as const, con_comprobante: true as const, motivo: long(maxRejectionReason, "Monto incorrecto "),
    })),
    entrega: { modalidad: "Agencia", destino: long(400, "Agencia "), courier: long(80, "Olva "), destinatario: long(200, "Ana "), telefono: "termina en 789", punto_de_recojo: long(100) },
    stock: "Esperando stock", preparacion: { listo: false, texto: `Para despachar falta stock de ${long(300, "Camisa (M · Azul), ")}.` },
  };
}
