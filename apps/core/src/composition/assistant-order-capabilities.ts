import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { orders } from "@core/src/features/orders";
import { deliverySettings } from "@core/src/features/delivery-settings";
import { parseOrderNumber } from "@core/src/features/orders/domain/checkout";
import { parseScheduledDispatchFilter, type AggregateCriteria } from "@core/src/features/orders/application/list-order-aggregates";
import type { DispatchDate } from "@shared/dispatch-date";
import { authIssuer } from "@core/src/shared/infrastructure/auth";
import { log } from "@core/src/shared/infrastructure/logger";
import type { AssistantAccess } from "@core/src/features/assistants/application/resolve-assistant-access";
import type { ToolRunError } from "@core/src/features/assistants/application/answer-tool-call";
import type { OrderToolsDependencies, SearchOrdersQuery } from "@core/src/features/assistants/presentation/tools/orders-tools";

type Failure = ToolRunError;
type Source = Readonly<{ code: string; message: string }>;

/** A read that failed: logged once here with the tool that hit it, never with inputs or data, and answered with the reading-failure text (`message: null` in the pipeline would also do). */
function failed(tool: string, access: AssistantAccess, error: Source): Failure {
  log.error({ event: "assistant_tool_failed", companyId: access.companyId, connectionId: access.connectionId, tool, errorCode: error.code }, "assistant_tool_failed");
  return { code: "FAILURE", message: readFailureText };
}
const readFailureText = "No pudimos leer tus pedidos en este momento. Inténtalo de nuevo en unos segundos.";
const orderAccess = (access: AssistantAccess) => ({ companyId: access.companyId, userId: access.userId });
const lift = <T, U>(tool: string, access: AssistantAccess, result: Result<T, Source>, map: (value: T) => U): Result<U, Failure> =>
  result.success ? ok(map(result.data)) : err(failed(tool, access, result.error));

function criteriaOf(query: SearchOrdersQuery): Result<AggregateCriteria, Failure> {
  const scheduled = parseScheduledDispatchFilter({
    ...(query.scheduled.from ? { scheduledFrom: query.scheduled.from as DispatchDate } : {}),
    ...(query.scheduled.through ? { scheduledThrough: query.scheduled.through as DispatchDate } : {}),
    ...(query.scheduled.unscheduled ? { unscheduled: "true" as const } : {}),
  });
  if (!scheduled.success) return err({ code: "INVALID_INPUT", message: "Revisa las fechas de despacho programado." });
  return ok({
    page: query.page, customer: { kind: "all" }, searchPhone: "exclude",
    ...(query.search ? { search: query.search } : {}), ...(query.view ? { view: query.view } : {}), ...(query.excludeCancelled ? { cancelled: "exclude" as const } : {}),
    ...(query.deliveryStatus ? { deliveryStatus: query.deliveryStatus } : {}), ...(query.courierId ? { courierId: query.courierId } : {}),
    ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}), ...(query.createdBefore ? { createdBefore: query.createdBefore } : {}),
    ...(query.shippedFrom ? { shippedFrom: query.shippedFrom } : {}), ...(query.shippedBefore ? { shippedBefore: query.shippedBefore } : {}),
    scheduled: scheduled.data,
  });
}

/** The order operations of the orders feature as the order tools consume them. Runs inside the connection's tenant context. */
export const orderToolsDependencies: OrderToolsDependencies = {
  clock: () => new Date(),
  link: (orderId) => `${authIssuer}/orders/${orderId}`,
  async listOrders(query, access) {
    const criteria = criteriaOf(query);
    if (!criteria.success) return criteria;
    const page = await orders.listAggregates(criteria.data, orderAccess(access));
    return lift("buscar_pedidos", access, page, ({ items, page: current, total }) => ({ items, page: current, total }));
  },
  async hasAnyOrder(access) {
    return lift("buscar_pedidos", access, await orders.hasAny({}, orderAccess(access)), (any) => any);
  },
  async listCouriers(access) {
    return lift("buscar_pedidos", access, await deliverySettings.listCouriers(access.companyId), (couriers) => couriers.map(({ id, name }) => ({ id, name })));
  },
  async findOrder(number, access) {
    const parsed = parseOrderNumber(number);
    if (!parsed.success) return err({ code: "NOT_FOUND", message: "" });
    const found = await orders.getAggregateByNumber({ number: parsed.data }, orderAccess(access));
    if (!found.success) return found.error.code === "ORDER_NOT_FOUND" ? err({ code: "NOT_FOUND", message: "" }) : err(failed("ver_pedido", access, found.error));
    const order = found.data;
    const described = await orders.describeDispatchStock([order]);
    if (!described.success) return err(failed("ver_pedido", access, described.error));
    const stock = described.data.get(order.id) ?? { stockDue: null, shortAtCurrentStock: [] };
    return ok({ order, stock: { stockDue: stock.stockDue }, readiness: orders.describeDispatchReadiness(order, stock) });
  },
  async summarizeUnpaid(access) {
    return lift("pedidos_por_cobrar", access, await orders.summarizeUnpaid({}, orderAccess(access)), (summary) => summary);
  },
  async listDispatchQueue(today, page, access) {
    return lift("pedidos_por_despachar_hoy", access, await orders.listDispatchQueue({ today: today as DispatchDate, page }, orderAccess(access)), (queue) => queue);
  },
};
