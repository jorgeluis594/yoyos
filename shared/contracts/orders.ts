import { z } from "zod";
import { currencies } from "@shared/money";
import { moneySchema } from "@shared/contracts/money";
import { pickupPointSchema } from "@shared/contracts/delivery-settings";

export const orderSelectionSchema = z.strictObject({
  id: z.uuid(),
  contactId: z.uuid().nullable(),
  items: z.array(z.strictObject({ variantId: z.uuid(), quantity: z.number().int().positive().safe() })).min(1),
});
export type OrderSelectionRequest = z.infer<typeof orderSelectionSchema>;

export const orderCustomerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("general_public") }),
  z.strictObject({ kind: z.literal("contact"), contactId: z.uuid(), name: z.string().nullable(), phone: z.string() }),
]);
export const orderBuyerSchema = z.strictObject({ contactId: z.uuid().nullable(), name: z.string().nullable(), phone: z.string() });
export const orderItemSchema = z.strictObject({ id: z.uuid(), variantId: z.uuid(), productName: z.string(), variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(), quantity: z.number().int().positive().safe(), unitPrice: z.number().positive(), subtotal: z.number().positive() });
export const orderSchema = z.strictObject({ number: z.number().int().safe().min(1001), id: z.uuid(), companyId: z.uuid(), sellerId: z.string(), buyer: orderBuyerSchema.nullable(), paymentMethod: z.literal("digital_wallet"), completedAt: z.iso.datetime(), currency: z.enum(currencies), items: z.array(orderItemSchema).min(1), total: z.number().positive() });
export type OrderResponse = z.infer<typeof orderSchema>;

export { moneySchema } from "@shared/contracts/money";
const identitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({ kind: z.literal("document"), documentType: z.enum(["national_id", "passport", "foreign_id"]), document: z.string().trim().min(1) }),
]);
const recipientSchema = z.strictObject({ name: z.string().trim().min(1), phone: z.string().trim().min(1), identity: identitySchema });
const agencyRecipientSchema = z.strictObject({ name: z.string().trim().min(1), phone: z.string().trim().min(1),
  identity: z.strictObject({ kind: z.literal("document"), documentType: z.enum(["national_id", "passport", "foreign_id"]), document: z.string().trim().min(1) }) });
const homeDestinationSchema = z.strictObject({ address: z.string().trim().min(1).max(500), district: z.string().trim().min(1).max(120), instructions: z.string().trim().min(1).max(1000).nullable() });
const deliveryAuthorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("seller"), userId: z.string().trim().min(1) }),
  z.strictObject({ kind: z.literal("buyer") }),
]);
export const deliverySelectionSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, destination: homeDestinationSchema }),
  z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema, courierId: z.uuid(), agency: z.string().trim().min(1).max(500) }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema }),
]);
export const ratedDeliverySelectionSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, rateId: z.uuid(), destination: z.strictObject({
    districtCode: z.string().regex(/^\d{6}$/), address: z.string().trim().min(1).max(500), instructions: z.string().trim().max(1000).nullable(),
  }) }),
  z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema, rateId: z.uuid(), districtCode: z.string().regex(/^\d{6}$/) }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema }),
]);
export const setRatedOrderDeliverySchema = z.strictObject({ delivery: ratedDeliverySelectionSchema, expectedPrice: moneySchema });
export type RatedDeliverySelectionRequest = z.infer<typeof ratedDeliverySelectionSchema>;
export type SetRatedOrderDeliveryRequest = z.infer<typeof setRatedOrderDeliverySchema>;
export type DeliverySelectionRequest = z.infer<typeof deliverySelectionSchema>;
export const setOrderDeliverySchema = z.strictObject({ delivery: deliverySelectionSchema, chargeDeliveryToCustomer: z.boolean() });
export type SetOrderDeliveryRequest = z.infer<typeof setOrderDeliverySchema>;

export const completeOrderSchema = orderSelectionSchema.extend({
  payments: z.array(z.strictObject({ paymentId: z.uuid(), amount: moneySchema,
    method: z.enum(["digital_wallet", "bank_transfer"]), deductStockIfPartial: z.boolean() })).optional(),
  delivery: setOrderDeliverySchema.optional(),
  deliverImmediately: z.boolean().optional(),
});
export const createRatedOrderSchema = completeOrderSchema.extend({ delivery: setRatedOrderDeliverySchema });
export type CreateRatedOrderRequest = z.infer<typeof createRatedOrderSchema>;
export type CompleteOrderRequest = z.infer<typeof completeOrderSchema>;
export const createOrderSchema = z.union([
  completeOrderSchema,
  orderSelectionSchema.extend({
    payment: z.strictObject({ method: z.literal("digital_wallet") }),
    delivery: z.strictObject({ method: z.literal("handover") }),
  }),
]);
export type CreateOrderRequest = z.infer<typeof createOrderSchema>;
const legacyDeliverySnapshotSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, destination: homeDestinationSchema, recordedBy: deliveryAuthorSchema }),
  z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema,
    courier: z.strictObject({ id: z.uuid(), name: z.string().trim().min(1).max(120) }), agency: z.string().trim().min(1).max(500), recordedBy: deliveryAuthorSchema }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema, pickupPoint: pickupPointSchema, recordedBy: deliveryAuthorSchema }),
]);
const settingsVersionSchema = z.number().int().min(0).max(2147483647);
const deliveryPricingSchema = z.strictObject({ quotationId: z.uuid(), rateId: z.uuid(), zoneId: z.uuid(), settingsVersion: settingsVersionSchema });
const peruDeliveryDistrictSchema = z.strictObject({ country: z.literal("PE"), districtCode: z.string().regex(/^\d{6}$/),
  district: z.string().trim().min(1).max(120), province: z.string().trim().min(1).max(120), department: z.string().trim().min(1).max(120) });
const ratedAgencyFields = { method: z.literal("agency"), recipient: agencyRecipientSchema, destination: peruDeliveryDistrictSchema,
  pricing: deliveryPricingSchema, recordedBy: deliveryAuthorSchema };
export const deliverySnapshotSchemas = [...legacyDeliverySnapshotSchema.options,
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, destination: homeDestinationSchema.extend(peruDeliveryDistrictSchema.shape),
    pricing: deliveryPricingSchema, recordedBy: deliveryAuthorSchema }),
  z.strictObject({ ...ratedAgencyFields, courier: z.null(), agency: z.null() }),
  z.strictObject({ ...ratedAgencyFields, courier: z.strictObject({ id: z.uuid(), name: z.string().trim().min(1).max(120) }), agency: z.string().trim().min(1).max(500) }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema, pickupPoint: pickupPointSchema, settingsVersion: settingsVersionSchema, recordedBy: deliveryAuthorSchema }),
] as const;
export const deliverySnapshotSchema = z.union(deliverySnapshotSchemas);
const reportDataSchema = z.strictObject({ receiptImageId: z.uuid(), reportedAt: z.iso.datetime() });
const confirmationDataSchema = z.strictObject({ confirmedAt: z.iso.datetime(),
  confirmedBy: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("seller"), userId: z.string().min(1) }), z.strictObject({ kind: z.literal("legacy") })]),
  evidence: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("manual") }), z.strictObject({ kind: z.literal("buyer_report"), report: reportDataSchema })]) });
const paymentIdentitySchema = { id: z.uuid(), orderId: z.uuid() };
export const paymentSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...paymentIdentitySchema, status: z.literal("reported"), currency: z.enum(currencies),
    amount: z.null(), method: z.null(), data: reportDataSchema }),
  z.strictObject({ ...paymentIdentitySchema, status: z.literal("confirmed"), amount: moneySchema,
    method: z.enum(["digital_wallet", "bank_transfer"]), data: confirmationDataSchema }),
  z.strictObject({ ...paymentIdentitySchema, status: z.literal("voided"), amount: moneySchema,
    method: z.enum(["digital_wallet", "bank_transfer"]), data: confirmationDataSchema.extend({ voidedAt: z.iso.datetime(), voidedBy: z.string().min(1) }) }),
]);
export const orderAggregateSchema = z.strictObject({ checkoutEnabledAt: z.iso.datetime().nullable(), checkoutConfirmedAt: z.iso.datetime().nullable(), number: z.number().int().safe().min(1001), id: z.uuid(), companyId: z.uuid(), sellerId: z.string(), buyer: orderBuyerSchema.nullable(),
  createdAt: z.iso.datetime(), deliveredAt: z.iso.datetime().nullable(), completedAt: z.iso.datetime().nullable(), status: z.enum(["active", "cancelled", "completed"]),
  paymentStatus: z.enum(["pending", "paid"]), paidAmount: moneySchema, balanceDue: moneySchema, overpaidAmount: moneySchema,
  cancelled: z.boolean(), delivery: deliverySnapshotSchema.nullable(), deliveryStatus: z.enum(["pending", "shipped", "delivered"]),
  stockDeducted: z.boolean(), items: z.array(z.strictObject({ id: z.uuid(), variantId: z.uuid(), productName: z.string(),
    variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(), quantity: z.number().int().positive().safe(),
    unitPrice: moneySchema, subtotal: moneySchema })).min(1), payments: z.array(paymentSchema),
  itemsTotal: moneySchema, deliveryCost: moneySchema, deliveryCharge: moneySchema, total: moneySchema });
export type OrderAggregateResponse = z.infer<typeof orderAggregateSchema>;
export const listOrderAggregatesSchema = z.strictObject({
  search: z.string().max(120).optional(),
  view: z.enum(["all", "unpaid", "undelivered"]).optional(),
  page: z.coerce.number().int().positive().safe().default(1),
  customer: z.enum(["all", "general_public", "contact"]).default("all"),
  contactId: z.uuid().optional(), createdFrom: z.iso.datetime().optional(), createdBefore: z.iso.datetime().optional(),
}).refine((value) => (value.customer === "contact") === !!value.contactId,
  { message: "Contact must match customer filter", path: ["contactId"] })
  .refine((value) => Number.isSafeInteger((value.page - 1) * 20),
    { message: "Page exceeds safe offset", path: ["page"] })
  .refine((value) => !value.createdFrom || !value.createdBefore ||
    new Date(value.createdFrom).getTime() < new Date(value.createdBefore).getTime(),
    { message: "Invalid date interval", path: ["createdBefore"] });
export type ListOrderAggregatesRequest = z.infer<typeof listOrderAggregatesSchema>;
export const orderAggregateSummarySchema = orderAggregateSchema.pick({ checkoutEnabledAt: true, checkoutConfirmedAt: true, number: true, id: true, createdAt: true, deliveredAt: true, completedAt: true, status: true,
  paymentStatus: true, deliveryStatus: true, stockDeducted: true, buyer: true, sellerId: true, total: true });
export const listOrderAggregatesResponseSchema = z.strictObject({ items: z.array(orderAggregateSummarySchema),
  page: z.number().int().positive(), pageSize: z.literal(20), total: z.number().int().nonnegative() });
export type ListOrderAggregatesResponse = z.infer<typeof listOrderAggregatesResponseSchema>;
export const registerPaymentSchema = z.strictObject({ paymentId: z.uuid(), source: z.enum(["manual", "buyer_report"]).optional(),
  amount: moneySchema, method: z.enum(["digital_wallet", "bank_transfer"]), deductStockIfPartial: z.boolean() });
export type RegisterPaymentRequest = z.infer<typeof registerPaymentSchema>;
export const stockOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deducted") }), z.strictObject({ kind: z.literal("not_requested") }),
]);
export const registerPaymentResponseSchema = z.strictObject({ order: orderAggregateSchema, stock: stockOutcomeSchema });
export type RegisterPaymentResponse = z.infer<typeof registerPaymentResponseSchema>;
export const reportPaymentSchema = z.strictObject({ paymentId: z.uuid(), receiptImageId: z.uuid() });
export const reportPaymentResponseSchema = z.strictObject({ paymentId: z.uuid(), status: z.literal("reported") });
export const buyerPaymentViewSchema = z.strictObject({ orderId: z.uuid(), total: moneySchema, deliveryCharge: moneySchema,
  paidAmount: moneySchema, balanceDue: moneySchema, paymentStatus: z.enum(["pending", "paid"]),
  settings: z.array(z.discriminatedUnion("method", [
    z.strictObject({ method: z.literal("digital_wallet"), provider: z.string(), holder: z.string(), imageUrl: z.url().nullable() }),
    z.strictObject({ method: z.literal("bank_transfer"), bank: z.string(), holder: z.string(), accountNumber: z.string().nullable(), cci: z.string().nullable(), imageUrl: z.url().nullable() }),
  ])),
  payments: z.array(z.strictObject({ id: z.uuid(), status: z.enum(["reported", "confirmed", "voided"]),
    amount: moneySchema.nullable(), method: z.enum(["digital_wallet", "bank_transfer"]).nullable(), receiptImageUrl: z.url().nullable() })) });
export type BuyerPaymentView = z.infer<typeof buyerPaymentViewSchema>;

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
export const orderSummarySchema = orderSchema.pick({ number: true, id: true, completedAt: true, buyer: true, sellerId: true, currency: true, total: true });
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
    "INVALID_PAYMENT", "PAYMENT_CONFLICT", "PAYMENT_NOT_FOUND", "RECEIPT_NOT_FOUND", "INVALID_TRANSITION", "DELIVERY_LOCKED", "PAYMENT_REQUIRED",
    "STOCK_NOT_DEDUCTED", "ORDER_CANCELLED", "DELIVERY_UNAVAILABLE",
    "DELIVERY_METHOD_DISABLED", "COURIER_UNAVAILABLE", "INTERNAL_ERROR", "RATE_UNAVAILABLE", "TOTAL_CHANGED", "INVALID_DISTRICT", "INVALID_DELIVERY_RATE",
  ]),
  error: z.string(),
  issues: z.array(orderApiIssueSchema).optional(),
  currentPrice: moneySchema.extend({ amount: z.number().finite().nonnegative().max(9999999999999.99).multipleOf(0.01) }).optional(),
});
export type OrderApiError = z.infer<typeof orderApiErrorSchema>;
export const orderActionErrorSchema = z.strictObject({ code: z.string(), error: z.string() });
export const newOrderLoaderSchema = z.strictObject({ products: orderCatalogSchema, contacts: orderContactsSchema, base: z.string() });
export const orderListLoaderSchema = z.strictObject({ list: listOrderAggregatesResponseSchema.extend({ items: z.array(orderAggregateSummarySchema.extend({ itemCount: z.number().int().positive().safe(), balanceDue: moneySchema })) }), filters: listOrderAggregatesSchema, contacts: orderContactsSchema, customerSearch: z.string(), base: z.string() });
export const orderDetailLoaderSchema = z.strictObject({ order: orderAggregateSchema, base: z.string(), manualPaymentId: z.uuid(),
  receiptUrls: z.record(z.string(), z.url()) });
