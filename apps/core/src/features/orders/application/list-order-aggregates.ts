import { z } from "zod";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { OrderAccess } from "@core/src/features/orders/application/create-order";
import type { OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, ContactId } from "@core/src/features/orders/domain/order";

export type AggregateCriteria = Readonly<{ page: number; customer: { kind: "all" } | { kind: "general_public" } | { kind: "contact"; contactId: ContactId };
  search?: string; view?: "all" | "unpaid" | "undelivered"; createdFrom?: Date; createdBefore?: Date }>;
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
    (criteria.createdFrom && criteria.createdBefore && criteria.createdFrom >= criteria.createdBefore))
    return err({ code: "INVALID_ORDER", message: "Invalid listing criteria" });
  return find({ ...criteria, ...(criteria.search !== undefined ? { search: criteria.search.trim() } : {}) }, context.companyId);
}
