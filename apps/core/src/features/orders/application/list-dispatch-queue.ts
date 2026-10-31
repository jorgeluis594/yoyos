import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DispatchDate } from "@shared/dispatch-date";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import { toStockOrder, type VariantStock } from "@core/src/features/orders/domain/stock-deduction";
import {
  classifyDispatchCandidate, describeDispatchStockOf, needsStockRead, orderDispatchQueue, pageOfDispatchQueue,
  type ClassifiedCandidate, type DispatchCandidate, type DispatchGroup, type DispatchQueueSummary, type DispatchReadiness, type DispatchStock,
} from "@core/src/features/orders/domain/dispatch-readiness";

export type DispatchQueueEntry = Readonly<{ group: DispatchGroup; order: OrderAggregate; readiness: DispatchReadiness }>;
export type DispatchQueuePage = Readonly<{
  entries: readonly DispatchQueueEntry[];
  page: number; total: number;
  summary: DispatchQueueSummary;
  undatedPending: number;
}>;
export type ListDispatchQueueInput = Readonly<{ today: DispatchDate; page: number }>;
export type ListDispatchQueueError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_ORDER" | "QUEUE_TOO_LARGE"; message: string }>;
export type ListDispatchQueueDependencies = Readonly<{
  /** Runs every read of one call against one snapshot. */
  inSnapshot: <T>(read: () => Promise<T>) => Promise<T>;
  /** `"too_many"` when more than `max` candidates exist. */
  findDispatchCandidates: (through: DispatchDate, max: number, companyId: CompanyId) => Promise<Result<readonly DispatchCandidate[] | "too_many", ListDispatchQueueError>>;
  readStock: (variantIds: readonly VariantId[]) => Promise<Result<VariantStock, ListDispatchQueueError>>;
  findAggregatesByIds: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly OrderAggregate[], ListDispatchQueueError>>;
  countUndatedPending: (companyId: CompanyId) => Promise<Result<number, ListDispatchQueueError>>;
  maxCandidates: number;
}>;

const variantsOf = (orders: readonly Readonly<{ items: readonly Readonly<{ variantId: VariantId }>[] }>[]) =>
  [...new Set(orders.flatMap((order) => order.items.map((item) => item.variantId)))];

/**
 * The pending orders scheduled today or earlier, overdue first, ready first. Candidates are classified on light rows; full aggregates are loaded for the page only.
 * Above `maxCandidates` it fails instead of answering a partial queue.
 */
export async function listDispatchQueue(input: ListDispatchQueueInput, context: OrderAccess, deps: ListDispatchQueueDependencies): Promise<Result<DispatchQueuePage, ListDispatchQueueError>> {
  if (!Number.isSafeInteger(input.page) || input.page <= 0) return err({ code: "INVALID_ORDER", message: "Invalid queue page" });
  return deps.inSnapshot(async () => {
    const candidates = await deps.findDispatchCandidates(input.today, deps.maxCandidates, context.companyId);
    if (!candidates.success) return candidates;
    if (candidates.data === "too_many") return err({ code: "QUEUE_TOO_LARGE" as const, message: "Too many orders in the dispatch queue" });
    const needStock = candidates.data.filter(needsStockRead);
    let stock: VariantStock = new Map();
    if (needStock.length > 0) {
      const read = await deps.readStock(variantsOf(needStock));
      if (!read.success) return read;
      stock = read.data;
    }
    const classified = candidates.data.flatMap((candidate): ClassifiedCandidate[] => {
      const { readiness } = classifyDispatchCandidate(candidate, stock);
      return readiness ? [{ candidate, readiness }] : [];
    });
    const queue = orderDispatchQueue(classified, input.today);
    const members = pageOfDispatchQueue(queue, input.page);
    const aggregates = members.length > 0 ? await deps.findAggregatesByIds(members.map((member) => member.candidate.id), context.companyId) : ok<readonly OrderAggregate[]>([]);
    if (!aggregates.success) return aggregates;
    const byId = new Map(aggregates.data.map((order) => [order.id, order]));
    const entries: DispatchQueueEntry[] = [];
    for (const member of members) {
      const order = byId.get(member.candidate.id);
      if (!order) return err({ code: "INVALID_ORDER" as const, message: "Queued order could not be loaded" });
      entries.push({ group: member.group, order, readiness: member.readiness });
    }
    const undated = await deps.countUndatedPending(context.companyId);
    if (!undated.success) return undated;
    return ok({ entries, page: input.page, total: queue.members.length, summary: queue.summary, undatedPending: undated.data });
  });
}

export type DescribeDispatchStockDependencies = Readonly<{
  readStock: (variantIds: readonly VariantId[]) => Promise<Result<VariantStock, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>>;
  inSnapshot: <T>(read: () => Promise<T>) => Promise<T>;
}>;

/** `stockDue` and the current-stock shortfall of full orders; one stock read for those that need it, none when nothing does. */
export async function describeDispatchStock(orders: readonly OrderAggregate[], deps: DescribeDispatchStockDependencies):
  Promise<Result<ReadonlyMap<OrderId, DispatchStock>, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>> {
  const stockOrders = orders.map((order) => ({ id: order.id, stockOrder: toStockOrder(order) }));
  const needStock = stockOrders.filter((entry) => needsStockRead(entry.stockOrder)).map((entry) => entry.stockOrder);
  let stock: VariantStock = new Map();
  if (needStock.length > 0) {
    const read = await deps.inSnapshot(() => deps.readStock(variantsOf(needStock)));
    if (!read.success) return read;
    stock = read.data;
  }
  return ok(new Map(stockOrders.map((entry) => [entry.id, describeDispatchStockOf(entry.stockOrder, stock)])));
}
