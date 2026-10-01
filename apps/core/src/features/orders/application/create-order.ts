import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { CreateOrderRequest } from "@shared/contracts/orders";
import { buildOrder, type Order, type CompanyId, type UserId, type ContactId, type OrderItemId, type OrderId, type PaymentId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem, ContactSnapshot } from "@core/src/features/orders/application/order-snapshots";

export type CreateOrderError = Readonly<{ code: "ORDER_ALREADY_EXISTS" | "CONTACT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "INSUFFICIENT_STOCK" | "CURRENCY_MISMATCH" | "INVALID_ORDER" | "PERSISTENCE_UNAVAILABLE"; message: string; variantId?: string; item?: number }>;
type LookupError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CreateOrderDependencies = Readonly<{
  transaction: <T>(callback: () => Promise<Result<T, CreateOrderError>>) => Promise<Result<T, CreateOrderError>>;
  orderExists: (id: string) => Promise<Result<boolean, LookupError>>;
  findContact: (id: string) => Promise<Result<ContactSnapshot | null, LookupError>>;
  findVariant: (id: string) => Promise<Result<CatalogItem | null, LookupError>>;
  save: (order: Order, paymentId: PaymentId) => Promise<Result<null, CreateOrderError>>;
  deductStock: (variantId: VariantId, quantity: number) => Promise<Result<null, CreateOrderError>>;
  newId: () => string;
  newPaymentId: () => PaymentId;
  clock: () => Date;
}>;

export async function createOrder(input: CreateOrderRequest, context: Readonly<{ companyId: string; sellerId: string }>, deps: CreateOrderDependencies): Promise<Result<Order, CreateOrderError>> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.id) || !uuid.test(context.companyId) || !context.sellerId || (input.contactId !== null && !uuid.test(input.contactId)) || !input.items.length ||
    new Set(input.items.map((item) => item.variantId)).size !== input.items.length ||
    input.items.some((item) => !uuid.test(item.variantId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
    return err({ code: "INVALID_ORDER", message: "Invalid order input" });
  }
  return deps.transaction(async () => {
    const existing = await deps.orderExists(input.id);
    if (!existing.success) return existing;
    if (existing.data) return err({ code: "ORDER_ALREADY_EXISTS", message: "Order already exists" });
    const contact = input.contactId === null ? null : await deps.findContact(input.contactId);
    if (contact && !contact.success) return contact;
    if (input.contactId !== null && (!contact || !contact.data)) return err({ code: "CONTACT_NOT_FOUND", message: "Contact is not available" });
    const items = [];
    for (const item of input.items) {
      const variant = await deps.findVariant(item.variantId);
      if (!variant.success) return variant;
      if (!variant.data) return err({ code: "VARIANT_NOT_FOUND", message: "Variant is not available", variantId: item.variantId });
      items.push({ ...variant.data, id: deps.newId() as OrderItemId, quantity: item.quantity });
    }
    const built = buildOrder({ id: input.id as OrderId, companyId: context.companyId as CompanyId, sellerId: context.sellerId as UserId,
      customer: contact && contact.success && contact.data ? { kind: "contact", contactId: contact.data.id as ContactId, name: contact.data.name, phone: contact.data.phone } : { kind: "general_public" },
      completedAt: deps.clock(), items });
    if (!built.success) return built;
    const saved = await deps.save(built.data, deps.newPaymentId());
    if (!saved.success) return saved;
    for (const item of [...built.data.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const deducted = await deps.deductStock(item.variantId, item.quantity);
      if (!deducted.success) return deducted;
    }
    return built;
  });
}
