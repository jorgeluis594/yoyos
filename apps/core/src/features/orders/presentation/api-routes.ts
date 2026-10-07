import { checkoutLinkSchema } from "@shared/contracts/order-checkout";
import { log, bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { createOrderSchema, setOrderDeliverySchema, orderSelectionSchema, listOrderAggregatesSchema, listOrdersSchema, orderCatalogSchema, orderContactsSchema, registerPaymentResponseSchema, registerPaymentSchema, type OrderSelectionRequest } from "@shared/contracts/orders";
import { parseDeliverySelection } from "@core/src/features/orders/domain/order-state-machine";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { orders, createConfiguredOrder } from "@core/src/features/orders/composition";
import { toLegacyOrderJson, toOrderAggregateJson, toOrderAggregateListJson, toOrderListJson } from "@core/src/features/orders/presentation/order-json";
import type { CreateOrderInput, OrderAccess } from "@core/src/features/orders/application/create-order";
import type { ContactId, CompanyId, OrderId, PaymentId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { RegisterPaymentInput } from "@core/src/features/orders/application/register-payment";
import type { VariantId } from "@core/src/features/products/domain/product";

const searchSchema = z.strictObject({ search: z.string().trim().max(100).default("") });

export function hasDuplicateJsonKeys(raw: string): boolean {
  const stack: ({ kind: "object"; keys: Set<string>; expectsKey: boolean } | { kind: "array" })[] = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      const start = index;
      while (++index < raw.length) {
        if (raw[index] === "\\") { index++; continue; }
        if (raw[index] === '"') break;
      }
      const top = stack.at(-1);
      if (top?.kind === "object" && top.expectsKey) {
        const key = JSON.parse(raw.slice(start, index + 1)) as string;
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectsKey = false;
      }
    } else if (char === "{") stack.push({ kind: "object", keys: new Set(), expectsKey: true });
    else if (char === "[") stack.push({ kind: "array" });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack.at(-1);
      if (top?.kind === "object") top.expectsKey = true;
    }
  }
  return false;
}

function queryFrom(request: Request, response: Response): Record<string, string> | null {
  const params = new URL(request.originalUrl, "http://localhost").searchParams;
  const query: Record<string, string> = {};
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) {
      apiError(response, 400, "INVALID_INPUT", "Duplicate query parameter", [{ field: key, reason: "DUPLICATE_FIELD" }]);
      return null;
    }
    query[key] = params.get(key)!;
  }
  return query;
}

function operationError(response: Response, error: { code: string; variantId?: string; item?: number }) {
  const issues = error.variantId || error.item !== undefined ? [{ field: "items", reason: error.code,
    ...(error.variantId ? { variantId: error.variantId } : {}), ...(error.item !== undefined ? { index: error.item } : {}) }] : undefined;
  switch (error.code) {
    case "INVALID_ORDER": return apiError(response, 422, "INVALID_ORDER", "Invalid order", issues);
    case "CURRENCY_MISMATCH": return apiError(response, 422, "CURRENCY_MISMATCH", "Currency mismatch", issues);
    case "CONTACT_NOT_FOUND": return apiError(response, 404, "CONTACT_NOT_FOUND", "Contact not found");
    case "VARIANT_NOT_FOUND": return apiError(response, 404, "VARIANT_NOT_FOUND", "Variant not found", issues);
    case "INSUFFICIENT_STOCK": return apiError(response, 409, "INSUFFICIENT_STOCK", "Insufficient stock", issues);
    case "ORDER_ALREADY_EXISTS": return apiError(response, 409, "ORDER_ALREADY_EXISTS", "Order already exists");
    case "ORDER_NOT_FOUND": return apiError(response, 404, "ORDER_NOT_FOUND", "Order not found");
    case "INVALID_PAYMENT": return apiError(response, 422, "INVALID_PAYMENT", "Invalid payment");
    case "PAYMENT_CONFLICT": return apiError(response, 409, "PAYMENT_CONFLICT", "Payment ID conflict");
    case "PAYMENT_NOT_FOUND": return apiError(response, 404, "PAYMENT_NOT_FOUND", "Payment not found");
    case "RECEIPT_NOT_FOUND": return apiError(response, 422, "RECEIPT_NOT_FOUND", "Receipt not found");
    case "INVALID_TRANSITION": return apiError(response, 409, "INVALID_TRANSITION", "Invalid order transition");
    case "DELIVERY_LOCKED": return apiError(response, 409, "DELIVERY_LOCKED", "Delivery is locked");
    case "PAYMENT_REQUIRED": return apiError(response, 409, "PAYMENT_REQUIRED", "Payment is required");
    case "STOCK_NOT_DEDUCTED": return apiError(response, 409, "STOCK_NOT_DEDUCTED", "Stock is not deducted");
    case "ORDER_CANCELLED": return apiError(response, 409, "ORDER_CANCELLED", "Order is cancelled");
    case "DELIVERY_UNAVAILABLE": return apiError(response, 422, "DELIVERY_UNAVAILABLE", "Delivery is unavailable");
    case "DELIVERY_METHOD_DISABLED": return apiError(response, 422, "DELIVERY_METHOD_DISABLED", "Delivery method is disabled");
    case "COURIER_UNAVAILABLE": return apiError(response, 422, "COURIER_UNAVAILABLE", "Courier is unavailable");
    case "INVALID_STORED_DATA": return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    default:
      log.error({ event: "unexpected_order_error", err: error }, "unexpected_order_error");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

function unexpected(response: Response, error: unknown, context?: Readonly<{ operation: string; orderId: string; userId: string }>) {
  log.error({ event: "order_api_operation_failed", ...(context ? { operation: context.operation, orderId: context.orderId, userId: context.userId } : {}), err: error }, "order_api_operation_failed");
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

export const orderRoutes = express.Router();
const orderContext = (response: Response<unknown, PrivateLocals>): OrderAccess => ({
  companyId: response.locals.auth.company.id as CompanyId, userId: response.locals.auth.user.id as UserId,
});
const orderId = (value: string | undefined) => z.uuid().safeParse(value);
function toCreateOrderInput(value: OrderSelectionRequest): CreateOrderInput {
  const [first, ...rest] = value.items;
  if (!first) throw new Error("Validated order has no items");
  const item = (selection: typeof first) => ({ variantId: selection.variantId as VariantId, quantity: selection.quantity as PositiveInteger });
  return { id: value.id as OrderId, contactId: value.contactId as ContactId | null, items: [item(first), ...rest.map(item)] };
}

orderRoutes.get("/", async (request, response) => {
  const query = queryFrom(request, response);
  if (!query) return;
  const parsed = listOrdersSchema.safeParse(query);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order filters");
  const { page, customer, contactId, completedFrom, completedBefore } = parsed.data;
  try {
    const result = await orders.list({ page,
      customer: customer === "contact" ? { kind: "contact", contactId: contactId as ContactId } : { kind: customer },
      ...(completedFrom ? { completedFrom: new Date(completedFrom) } : {}),
      ...(completedBefore ? { completedBefore: new Date(completedBefore) } : {}),
    });
    return result.success ? response.json(toOrderListJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.get("/mixed", async (request, response: Response<unknown, PrivateLocals>) => {
  const query = queryFrom(request, response);
  if (!query) return;
  const parsed = listOrderAggregatesSchema.safeParse(query);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order filters");
  const { page, customer, contactId, createdFrom, createdBefore, search, view } = parsed.data;
  try {
    const result = await orders.listAggregates({ page, search, view,
      customer: customer === "contact" ? { kind: "contact", contactId: contactId as ContactId } : { kind: customer },
      ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}),
      ...(createdBefore ? { createdBefore: new Date(createdBefore) } : {}),
    }, orderContext(response));
    return result.success ? response.json(toOrderAggregateListJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.get("/catalog", async (request, response) => {
  const query = queryFrom(request, response);
  if (!query) return;
  const parsed = searchSchema.safeParse(query);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid search");
  try {
    const result = await orders.searchProducts(parsed.data.search);
    return result.success ? response.json(orderCatalogSchema.parse(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.get("/contacts", async (request, response) => {
  const query = queryFrom(request, response);
  if (!query) return;
  const parsed = searchSchema.safeParse(query);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid search");
  try {
    const result = await orders.searchContacts(parsed.data.search);
    return result.success ? response.json(orderContactsSchema.parse(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.get("/:id", async (request, response: Response<unknown, PrivateLocals>) => {
  const parsed = z.uuid().safeParse(request.params.id);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order ID");
  try {
    const result = await orders.getAggregate(parsed.data as OrderId, orderContext(response));
    if (!result.success) return operationError(response, result.error);
    return result.data.completedAt && result.data.deliveryStatus === "delivered"
      ? response.json(toLegacyOrderJson(result.data)) : apiError(response, 404, "ORDER_NOT_FOUND", "Order not found");
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.get("/:id/aggregate", async (request, response: Response<unknown, PrivateLocals>) => {
  const parsed = orderId(request.params.id);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order ID");
  try {
    const result = await orders.getAggregate(parsed.data as OrderId, orderContext(response));
    return result.success ? response.json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.post("/pending", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = orderSelectionSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order input");
  try {
    const result = await orders.create(toCreateOrderInput(parsed.data), orderContext(response));
    return result.success ? response.status(201).json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.post("/immediate-sale", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = orderSelectionSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order input");
  try {
    const result = await orders.registerImmediateSale(toCreateOrderInput(parsed.data), orderContext(response));
    return result.success ? response.status(201).json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.post("/:id/payments", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsedId = orderId(request.params.id);
  const parsed = registerPaymentSchema.safeParse(request.body);
  if (!parsedId.success || !parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid payment input");
  try {
    const input: RegisterPaymentInput = { ...parsed.data, orderId: parsedId.data as OrderId, paymentId: parsed.data.paymentId as PaymentId };
    const result = await orders.registerPayment(input, orderContext(response));
    return result.success ? response.json(registerPaymentResponseSchema.parse({ order: toOrderAggregateJson(result.data.order), stock: result.data.stock }))
      : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.put("/:id/delivery", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsedId = orderId(request.params.id);
  const parsed = setOrderDeliverySchema.safeParse(request.body);
  if (!parsedId.success || !parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid delivery input");
  const selection = parseDeliverySelection(parsed.data.delivery);
  if (!selection.success) return operationError(response, selection.error);
  const context = orderContext(response);
  try {
    const result = await orders.setDelivery({ orderId: parsedId.data as OrderId, delivery: selection.data,
      chargeDeliveryToCustomer: parsed.data.chargeDeliveryToCustomer }, context);
    return result.success ? response.json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
  } catch (cause) { return unexpected(response, cause, { operation: "set_order_delivery", orderId: parsedId.data, userId: context.userId }); }
});

orderRoutes.post("/:id/payments/:paymentId/void", async (request, response: Response<unknown, PrivateLocals>) => {
  const parsedId = orderId(request.params.id);
  const parsedPaymentId = z.uuid().safeParse(request.params.paymentId);
  if (!parsedId.success || !parsedPaymentId.success) return apiError(response, 400, "INVALID_INPUT", "Invalid payment ID");
  try {
    const result = await orders.voidPayment({ orderId: parsedId.data as OrderId, paymentId: parsedPaymentId.data as PaymentId }, orderContext(response));
    return result.success ? response.json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

for (const [path, operation] of [
  ["deduct-stock", orders.deductStock], ["cancel", orders.cancel], ["ship", orders.ship], ["deliver", orders.deliver],
] as const) {
  orderRoutes.post(`/:id/${path}`, async (request, response: Response<unknown, PrivateLocals>) => {
    const parsed = orderId(request.params.id);
    if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order ID");
    try {
      const result = await operation(parsed.data as OrderId, orderContext(response));
      return result.success ? response.json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
    } catch (error) { return unexpected(response, error); }
  });
}

orderRoutes.post("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = createOrderSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order input");
  try {
    const input = toCreateOrderInput(parsed.data);
    const context = orderContext(response);
    if ("payment" in parsed.data) {
      const result = await orders.registerImmediateSale(input, context);
      return result.success ? response.status(201).json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
    }
    const selection = parsed.data.delivery ? parseDeliverySelection(parsed.data.delivery.delivery) : null;
    if (selection && !selection.success) return operationError(response, selection.error);
    const result = await createConfiguredOrder({ ...input,
      payments: parsed.data.payments?.map(payment => ({ ...payment, paymentId: payment.paymentId as PaymentId })),
      delivery: selection?.success && parsed.data.delivery ? { delivery: selection.data,
        chargeDeliveryToCustomer: parsed.data.delivery.chargeDeliveryToCustomer } : undefined,
      deliverImmediately: parsed.data.deliverImmediately }, context);
    return result.success ? response.status(201).json(toOrderAggregateJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.post("/:orderId/checkout-link", async (request, response: Response<unknown, PrivateLocals>) => {
  bindRequestOperation({ operation: "enable_checkout" });
  const id = orderId(request.params.orderId);
  if (!id.success || !z.strictObject({}).safeParse(request.body ?? {}).success) {
    bindRequestOperation({ outcome: "invalid_input" });
    return apiError(response, 422, "INVALID_INPUT", "Invalid checkout request");
  }
  try {
    const result = await orders.enableCheckout(id.data as OrderId, orderContext(response));
    if (!result.success) {
      if (result.error.code === "CHECKOUT_UNAVAILABLE") return apiError(response, 404, "ORDER_NOT_FOUND", "Order not found");
      if (result.error.code === "ORDER_CANCELLED") return apiError(response, 409, "ORDER_CANCELLED", "Order is cancelled");
      return apiError(response, 503, "SERVICE_UNAVAILABLE", "Checkout is unavailable");
    }
    return response.json(checkoutLinkSchema.parse(result.data));
  } catch (cause) {
    bindRequestOperation({ outcome: "technical_failure" });
    return unexpected(response, cause);
  }
});
