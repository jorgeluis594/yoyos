import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ContactId, Order } from "@core/src/features/orders/domain/order";

export type OrderCriteria = Readonly<{ page: number; customer: { kind: "all" } | { kind: "general_public" } | { kind: "contact"; contactId: ContactId }; completedFrom?: Date; completedBefore?: Date }>;

type ReadError = Readonly<{ code: "INVALID_ORDER" | "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
type Summary = Readonly<{ id: string; completedAt: Date; sellerId: string; customer: { kind: "general_public" } | { kind: "contact"; contactId: string; name: string | null; phone: string }; total: { amount: number; currency: string } }>;
export type ListOrdersOutput = Readonly<{ items: readonly Summary[]; page: number; pageSize: number; total: number }>;

export async function listOrders(criteria: OrderCriteria, find: (criteria: OrderCriteria) => Promise<Result<ListOrdersOutput, ReadError>>): Promise<Result<ListOrdersOutput, ReadError>> {
  if (!Number.isSafeInteger(criteria.page) || criteria.page <= 0 || !Number.isSafeInteger((criteria.page - 1) * 20) ||
    (criteria.customer.kind === "contact" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(criteria.customer.contactId)) ||
    (criteria.completedFrom && !Number.isFinite(criteria.completedFrom.getTime())) || (criteria.completedBefore && !Number.isFinite(criteria.completedBefore.getTime())) ||
    (criteria.completedFrom && criteria.completedBefore && criteria.completedFrom >= criteria.completedBefore)) return err({ code: "INVALID_ORDER", message: "Invalid listing criteria" });
  return find(criteria);
}

export async function getOrder(id: string, find: (id: string) => Promise<Result<Order | null, ReadError>>): Promise<Result<Order, ReadError>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return err({ code: "INVALID_ORDER", message: "Invalid order ID" });
  const result = await find(id);
  return result.success ? result.data ? { success: true, data: result.data } : err({ code: "ORDER_NOT_FOUND", message: "Order not found" }) : result;
}
