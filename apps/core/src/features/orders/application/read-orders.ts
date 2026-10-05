import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ContactId } from "@core/src/features/orders/domain/order";

export type OrderCriteria = Readonly<{ page: number; customer: { kind: "all" } | { kind: "general_public" } | { kind: "contact"; contactId: ContactId }; completedFrom?: Date; completedBefore?: Date }>;

type ReadError = Readonly<{ code: "INVALID_ORDER" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
type Summary = Readonly<{ number: number; id: string; completedAt: Date; sellerId: string; buyer: { contactId: string | null; name: string | null; phone: string } | null; total: { amount: number; currency: string } }>;
export type ListOrdersOutput = Readonly<{ items: readonly Summary[]; page: number; pageSize: number; total: number }>;

export async function listOrders(criteria: OrderCriteria, find: (criteria: OrderCriteria) => Promise<Result<ListOrdersOutput, ReadError>>): Promise<Result<ListOrdersOutput, ReadError>> {
  if (!Number.isSafeInteger(criteria.page) || criteria.page <= 0 || !Number.isSafeInteger((criteria.page - 1) * 20) ||
    (criteria.customer.kind === "contact" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(criteria.customer.contactId)) ||
    (criteria.completedFrom && !Number.isFinite(criteria.completedFrom.getTime())) || (criteria.completedBefore && !Number.isFinite(criteria.completedBefore.getTime())) ||
    (criteria.completedFrom && criteria.completedBefore && criteria.completedFrom >= criteria.completedBefore)) return err({ code: "INVALID_ORDER", message: "Invalid listing criteria" });
  return find(criteria);
}
