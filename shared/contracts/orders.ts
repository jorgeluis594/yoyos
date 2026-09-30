import { z } from "zod";
import { currencies } from "@shared/money";

export const createOrderSchema = z.strictObject({
  id: z.uuid(),
  contactId: z.uuid().nullable(),
  items: z.array(z.strictObject({ variantId: z.uuid(), quantity: z.number().int().positive().safe() })).min(1),
});
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;

export const orderCustomerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("general_public") }),
  z.strictObject({ kind: z.literal("contact"), contactId: z.uuid(), name: z.string().nullable(), phone: z.string() }),
]);
export const orderItemSchema = z.strictObject({ id: z.uuid(), variantId: z.uuid(), productName: z.string(), variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(), quantity: z.number().int().positive().safe(), unitPrice: z.number().positive(), subtotal: z.number().positive() });
export const orderSchema = z.strictObject({ id: z.uuid(), companyId: z.uuid(), sellerId: z.string(), customer: orderCustomerSchema, paymentMethod: z.literal("digital_wallet"), completedAt: z.iso.datetime(), currency: z.enum(currencies), items: z.array(orderItemSchema).min(1), total: z.number().positive() });
export type OrderResponse = z.infer<typeof orderSchema>;

export const listOrdersSchema = z.strictObject({
  page: z.coerce.number().int().positive().safe().default(1),
  customer: z.enum(["all", "general_public", "contact"]).default("all"),
  contactId: z.uuid().optional(),
  completedFrom: z.iso.datetime().optional(),
  completedBefore: z.iso.datetime().optional(),
}).refine((value) => (value.customer === "contact") === !!value.contactId,
  { message: "Contact must match customer filter", path: ["contactId"] })
  .refine((value) => Number.isSafeInteger((value.page - 1) * 20),
    { message: "Page exceeds safe offset", path: ["page"] })
  .refine((value) => !value.completedFrom || !value.completedBefore ||
    new Date(value.completedFrom).getTime() < new Date(value.completedBefore).getTime(),
    { message: "Invalid date interval", path: ["completedBefore"] });
export type ListOrdersRequest = z.infer<typeof listOrdersSchema>;
export const orderSummarySchema = orderSchema.pick({ id: true, completedAt: true, customer: true, sellerId: true, currency: true, total: true });
export const listOrdersResponseSchema = z.strictObject({ items: z.array(orderSummarySchema), page: z.number().int().positive(), pageSize: z.literal(20), total: z.number().int().nonnegative() });
export const orderCatalogSchema = z.array(z.strictObject({ id: z.uuid(), name: z.string(), currency: z.enum(currencies),
  variants: z.array(z.strictObject({ id: z.uuid(), attributes: z.record(z.string(), z.string()), sku: z.string().nullable(), price: z.number().positive(), stock: z.number().int().nonnegative().safe() })) }));
export const orderContactsSchema = z.array(z.strictObject({ id: z.uuid(), name: z.string().nullable(), phone: z.string() }));
export const orderApiIssueSchema = z.strictObject({
  field: z.string(), reason: z.string(), index: z.number().int().nonnegative().optional(), variantId: z.uuid().optional(),
});
export type OrderApiIssue = z.infer<typeof orderApiIssueSchema>;
export const orderApiErrorSchema = z.strictObject({
  code: z.enum([
    "INVALID_INPUT", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE",
    "INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND", "VARIANT_NOT_FOUND",
    "INSUFFICIENT_STOCK", "ORDER_ALREADY_EXISTS", "ORDER_NOT_FOUND", "SERVICE_UNAVAILABLE",
  ]),
  error: z.string(),
  issues: z.array(orderApiIssueSchema).optional(),
});
export type OrderApiError = z.infer<typeof orderApiErrorSchema>;
export const orderActionErrorSchema = z.strictObject({ code: z.string(), error: z.string() });
export const newOrderLoaderSchema = z.strictObject({ products: orderCatalogSchema, contacts: orderContactsSchema, base: z.string() });
export const orderListLoaderSchema = z.strictObject({ list: listOrdersResponseSchema, filters: listOrdersSchema, contacts: orderContactsSchema, customerSearch: z.string(), base: z.string() });
export const orderDetailLoaderSchema = z.strictObject({ order: orderSchema, base: z.string() });
