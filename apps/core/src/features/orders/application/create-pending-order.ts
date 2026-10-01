import { z } from "zod";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, ContactId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem, ContactSnapshot } from "@core/src/features/orders/application/order-snapshots";

export type CreatePendingOrderInput = Readonly<{ id: OrderId; contactId: ContactId | null;
  items: readonly [Readonly<{ variantId: VariantId; quantity: PositiveInteger }>, ...Readonly<{ variantId: VariantId; quantity: PositiveInteger }> []] }>;
export type OrderAccess = Readonly<{ companyId: CompanyId; userId: UserId }>;
export type CreatePendingOrderError = Readonly<{ code: "INVALID_ORDER" | "CURRENCY_MISMATCH" | "ORDER_ALREADY_EXISTS" | "CONTACT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE";
  message: string; variantId?: string; item?: number }>;
type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CreatePendingOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreatePendingOrderError>>) => Promise<Result<T, CreatePendingOrderError>>;
  orderExists: (id: OrderId, companyId: CompanyId) => Promise<Result<boolean, PersistenceError>>;
  findContact: (id: ContactId, companyId: CompanyId) => Promise<Result<ContactSnapshot | null, PersistenceError>>;
  findVariant: (id: VariantId, companyId: CompanyId) => Promise<Result<CatalogItem | null, PersistenceError>>;
  saveOrder: (order: OrderAggregate) => Promise<Result<null, PersistenceError | Readonly<{ code: "ORDER_ALREADY_EXISTS"; message: string }>>>;
  newItemId: () => OrderItemId;
  clock: () => Date;
}>;

const selection = z.strictObject({ id: z.uuid(), contactId: z.uuid().nullable(), items: z.array(z.strictObject({
  variantId: z.uuid(), quantity: z.number().int().positive().safe(),
})).min(1) });
const access = z.strictObject({ companyId: z.uuid(), userId: z.string().min(1) });

export async function createPendingOrder(input: CreatePendingOrderInput, context: OrderAccess, deps: CreatePendingOrderDependencies): Promise<Result<OrderAggregate, CreatePendingOrderError>> {
  if (!selection.safeParse(input).success || !access.safeParse(context).success ||
    new Set(input.items.map((item) => item.variantId)).size !== input.items.length) return err({ code: "INVALID_ORDER", message: "Invalid order input" });
  return deps.transaction(context.companyId, async () => {
    const existing = await deps.orderExists(input.id, context.companyId);
    if (!existing.success) return existing;
    if (existing.data) return err({ code: "ORDER_ALREADY_EXISTS", message: "Order already exists" });
    const contact = input.contactId === null ? null : await deps.findContact(input.contactId, context.companyId);
    if (contact && !contact.success) return contact;
    if (input.contactId !== null && (!contact || !contact.data)) return err({ code: "CONTACT_NOT_FOUND", message: "Contact is not available" });
    const items = [];
    for (const item of input.items) {
      const variant = await deps.findVariant(item.variantId, context.companyId);
      if (!variant.success) return variant;
      if (!variant.data) return err({ code: "VARIANT_NOT_FOUND", message: "Variant is not available", variantId: item.variantId });
      items.push({ ...variant.data, id: deps.newItemId(), quantity: item.quantity });
    }
    const built = buildPendingOrder({ id: input.id, companyId: context.companyId, sellerId: context.userId,
      customer: contact && contact.success && contact.data ? { kind: "contact", contactId: contact.data.id as ContactId,
        name: contact.data.name, phone: contact.data.phone } : { kind: "general_public" },
      createdAt: deps.clock(), items });
    if (!built.success) return built;
    const saved = await deps.saveOrder(built.data);
    return saved.success ? built : saved;
  });
}
