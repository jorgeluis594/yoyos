import { z } from "zod";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { DispatchDate } from "@shared/dispatch-date";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, ContactId } from "@core/src/features/orders/domain/order";

export type ScheduledDispatchFilter =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "unscheduled" }>
  | Readonly<{ kind: "from"; from: DispatchDate }>
  | Readonly<{ kind: "through"; through: DispatchDate }>
  | Readonly<{ kind: "between"; from: DispatchDate; through: DispatchDate }>;

/** Normalizes the scheduled-date query params; "unscheduled" excludes any range and bounds must be ordered (ISO dates compare lexically). */
export function parseScheduledDispatchFilter(query: Readonly<{ scheduledFrom?: DispatchDate; scheduledThrough?: DispatchDate; unscheduled?: "true" }>): Result<ScheduledDispatchFilter> {
  const { scheduledFrom: from, scheduledThrough: through, unscheduled } = query;
  if (unscheduled) return from || through ? err({ message: "Unscheduled excludes a date range", code: "INVALID_SCHEDULED_FILTER" }) : { success: true, data: { kind: "unscheduled" } };
  if (from && through) return from > through ? err({ message: "Invalid scheduled interval", code: "INVALID_SCHEDULED_FILTER" }) : { success: true, data: { kind: "between", from, through } };
  if (from) return { success: true, data: { kind: "from", from } };
  if (through) return { success: true, data: { kind: "through", through } };
  return { success: true, data: { kind: "all" } };
}

export type AggregateCriteria = Readonly<{ page: number; customer: { kind: "all" } | { kind: "general_public" } | { kind: "contact"; contactId: ContactId };
  search?: string; view?: "all" | "unpaid" | "undelivered"; createdFrom?: Date; createdBefore?: Date;
  deliveryStatus?: "pending" | "shipped" | "delivered"; courierId?: string; scheduled?: ScheduledDispatchFilter; shippedFrom?: Date; shippedBefore?: Date }>;
export type AggregatePage = Readonly<{ items: readonly OrderAggregate[]; page: number; pageSize: 20; total: number }>;
type ListError = Readonly<{ code: "INVALID_ORDER" | "PERSISTENCE_UNAVAILABLE"; message: string }>;

export async function listOrderAggregates(criteria: AggregateCriteria, context: OrderAccess,
  find: (criteria: AggregateCriteria, companyId: CompanyId) => Promise<Result<AggregatePage, ListError>>): Promise<Result<AggregatePage, ListError>> {
  if ((criteria.search !== undefined && (typeof criteria.search !== "string" || criteria.search.length > 120)) ||
    (criteria.view !== undefined && !["all", "unpaid", "undelivered"].includes(criteria.view)) ||
    !Number.isSafeInteger(criteria.page) || criteria.page <= 0 || !Number.isSafeInteger((criteria.page - 1) * 20) ||
    (criteria.customer.kind === "contact" && !z.uuid().safeParse(criteria.customer.contactId).success) ||
    (criteria.createdFrom && !Number.isFinite(criteria.createdFrom.getTime())) ||
    (criteria.createdBefore && !Number.isFinite(criteria.createdBefore.getTime())) ||
    (criteria.createdFrom && criteria.createdBefore && criteria.createdFrom >= criteria.createdBefore) ||
    (criteria.courierId !== undefined && !z.uuid().safeParse(criteria.courierId).success) ||
    (criteria.shippedFrom && !Number.isFinite(criteria.shippedFrom.getTime())) ||
    (criteria.shippedBefore && !Number.isFinite(criteria.shippedBefore.getTime())) ||
    (criteria.shippedFrom && criteria.shippedBefore && criteria.shippedFrom >= criteria.shippedBefore))
    return err({ code: "INVALID_ORDER", message: "Invalid listing criteria" });
  return find({ ...criteria, ...(criteria.search !== undefined ? { search: criteria.search.trim() } : {}) }, context.companyId);
}
