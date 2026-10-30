import type { OrderNumber } from "@core/src/features/orders/domain/checkout";
import { z } from "zod";
import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import { buildPendingOrder, type OrderAggregate } from "@core/src/features/orders/domain/order-state-machine";
import type { CompanyId, OrderId, OrderItemId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import { internationalPhonePattern } from "@shared/phone";
import { parseDispatchDate, type DispatchDate } from "@shared/dispatch-date";
import type { VariantId } from "@core/src/features/products/domain/product";
import type { CatalogItem } from "@core/src/features/orders/application/order-snapshots";

export type CreateOrderInput = Readonly<{ id: OrderId; scheduledDispatchDate?: DispatchDate; customer?: Readonly<{ name: string; phone: string }>;
  items: readonly [Readonly<{ variantId: VariantId; quantity: PositiveInteger }>, ...Readonly<{ variantId: VariantId; quantity: PositiveInteger }> []] }>;
export type OrderAccess = Readonly<{ companyId: CompanyId; userId: UserId }>;
export type CreateOrderError = Readonly<{ code: "INVALID_ORDER" | "CURRENCY_MISMATCH" | "ORDER_ALREADY_EXISTS" | "VARIANT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE";
  message: string; variantId?: string; item?: number }>;
type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type CreateOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, CreateOrderError>>) => Promise<Result<T, CreateOrderError>>;
  orderExists: (id: OrderId, companyId: CompanyId) => Promise<Result<boolean, PersistenceError>>;
  /** One lookup for the whole order. Variants that are not sellable are absent from the result. */
  findVariants: (ids: readonly VariantId[], companyId: CompanyId) => Promise<Result<readonly CatalogItem[], PersistenceError>>;
  allocateNumber: (companyId: CompanyId) => Promise<Result<OrderNumber, PersistenceError>>;
  saveOrder: (order: OrderAggregate) => Promise<Result<null, PersistenceError | Readonly<{ code: "ORDER_ALREADY_EXISTS"; message: string }> | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: string }>>>;
  newItemId: () => OrderItemId;
  clock: () => Date;
}>;

const selection = z.strictObject({ id: z.uuid(), customer: z.strictObject({ name: z.string().trim().min(1), phone: z.string().regex(internationalPhonePattern) }).optional(), scheduledDispatchDate: z.string().refine((value) => parseDispatchDate(value).success).optional(), items: z.array(z.strictObject({
  variantId: z.uuid(), quantity: z.number().int().positive().safe(),
})).min(1) });
const access = z.strictObject({ companyId: z.uuid(), userId: z.string().min(1) });

export async function createOrder(input: CreateOrderInput, context: OrderAccess, deps: CreateOrderDependencies): Promise<Result<OrderAggregate, CreateOrderError>> {
  if (!selection.safeParse(input).success || !access.safeParse(context).success ||
    new Set(input.items.map((item) => item.variantId)).size !== input.items.length) return err({ code: "INVALID_ORDER", message: "Invalid order input" });
  return deps.transaction(context.companyId, () => createOrderInTransaction(input, context, deps));
}

export async function createOrderInTransaction(input: CreateOrderInput, context: OrderAccess, deps: Omit<CreateOrderDependencies, "transaction">): Promise<Result<OrderAggregate, CreateOrderError>> {
  if (!selection.safeParse(input).success || !access.safeParse(context).success ||
    new Set(input.items.map((item) => item.variantId)).size !== input.items.length) return err({ code: "INVALID_ORDER", message: "Invalid order input" });
  const existing = await deps.orderExists(input.id, context.companyId);
  if (!existing.success) return existing;
  if (existing.data) return err({ code: "ORDER_ALREADY_EXISTS", message: "Order already exists" });
  const found = await deps.findVariants(input.items.map((item) => item.variantId), context.companyId);
  if (!found.success) return found;
  const byId = new Map(found.data.map((variant) => [variant.variantId, variant]));
  const items = [];
  for (const item of input.items) {
    const variant = byId.get(item.variantId);
    if (!variant) return err({ code: "VARIANT_NOT_FOUND", message: "Variant is not available", variantId: item.variantId });
    const { variantId, productName, variantAttributes, sku, unitPrice } = variant;
    items.push({ variantId, productName, variantAttributes, sku, unitPrice, id: deps.newItemId(), quantity: item.quantity });
  }
  const number = await deps.allocateNumber(context.companyId);
  if (!number.success) return number;
  const built = buildPendingOrder({ number: number.data, id: input.id, companyId: context.companyId, sellerId: context.userId,
    customer: input.customer ? { kind: "buyer", name: input.customer.name.trim(), phone: input.customer.phone } : { kind: "general_public" },
    createdAt: deps.clock(), items, scheduledDispatchDate: input.scheduledDispatchDate });
  if (!built.success) return built;
  const saved = await deps.saveOrder(built.data);
  return saved.success ? built : saved;
}
