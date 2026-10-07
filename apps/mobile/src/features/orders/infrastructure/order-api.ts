import { checkoutLinkSchema } from "@shared/contracts/order-checkout";
import { z } from "zod";
import { createOrderSchema, listOrderAggregatesResponseSchema, listOrderAggregatesSchema, listOrdersResponseSchema, listOrdersSchema, orderAggregateSchema, orderApiErrorSchema,
  orderCatalogSchema, orderContactsSchema, setOrderDeliverySchema, type SetOrderDeliveryRequest, registerPaymentResponseSchema, registerPaymentSchema, type CreateOrderRequest, type ListOrderAggregatesRequest, type ListOrdersRequest, type RegisterPaymentRequest,
  type OrderAggregateResponse, type OrderApiError } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import { imageResponseSchema } from "@shared/contracts/images";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

import type { OrderRequestError } from "@mobile/features/orders/application/order-operations";

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
type Operation = "fulfillment" | "delivery" | "checkout" | "list" | "mixed" | "get" | "aggregate" | "create" | "payment" | "void" | "deduct" | "catalog" | "contacts";

const statusByCode: Record<OrderApiError["code"], number> = {
  INVALID_INPUT: 400, UNSUPPORTED_MEDIA_TYPE: 415, PAYLOAD_TOO_LARGE: 413,
  INVALID_ORDER: 422, CURRENCY_MISMATCH: 422, CONTACT_NOT_FOUND: 404, VARIANT_NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409, ORDER_ALREADY_EXISTS: 409, ORDER_NOT_FOUND: 404, SERVICE_UNAVAILABLE: 503,
  INVALID_PAYMENT: 422, PAYMENT_CONFLICT: 409, PAYMENT_NOT_FOUND: 404, RECEIPT_NOT_FOUND: 422, INVALID_TRANSITION: 409, DELIVERY_LOCKED: 409,
  PAYMENT_REQUIRED: 409, STOCK_NOT_DEDUCTED: 409, ORDER_CANCELLED: 409, DELIVERY_UNAVAILABLE: 422,
  INTERNAL_ERROR: 500, DELIVERY_METHOD_DISABLED: 422, COURIER_UNAVAILABLE: 422,
};
function httpErrorSchema(codes: readonly OrderApiError["code"][], invalidInputStatus = 400) {
  return z.object({
    status: z.number(),
    body: orderApiErrorSchema.extend({
      code: z.enum(["INVALID_INPUT", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", ...codes]),
    }),
  }).refine(({ status, body }) => status === (
    body.code === "INVALID_INPUT" ? invalidInputStatus : statusByCode[body.code]
  ));
}

const commonErrorSchema = httpErrorSchema([]);
const getErrorSchema = httpErrorSchema(["ORDER_NOT_FOUND"]);
const errorSchemas = {
  checkout: httpErrorSchema(["ORDER_NOT_FOUND", "ORDER_CANCELLED"], 422),
  create: httpErrorSchema(["INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND", "VARIANT_NOT_FOUND",
    "INSUFFICIENT_STOCK", "ORDER_ALREADY_EXISTS", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]),
  payment: httpErrorSchema(["ORDER_NOT_FOUND", "INVALID_ORDER", "INVALID_PAYMENT", "CURRENCY_MISMATCH",
    "PAYMENT_CONFLICT", "PAYMENT_NOT_FOUND", "INVALID_TRANSITION", "ORDER_CANCELLED", "INSUFFICIENT_STOCK",
    "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]),
  void: httpErrorSchema(["ORDER_NOT_FOUND", "PAYMENT_NOT_FOUND", "PAYMENT_CONFLICT", "INVALID_TRANSITION", "INVALID_ORDER"]),
  delivery: httpErrorSchema(["ORDER_NOT_FOUND", "INVALID_ORDER", "CURRENCY_MISMATCH", "ORDER_CANCELLED", "DELIVERY_LOCKED",
    "DELIVERY_METHOD_DISABLED", "COURIER_UNAVAILABLE", "DELIVERY_UNAVAILABLE", "INSUFFICIENT_STOCK",
    "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]),
  fulfillment: httpErrorSchema(["ORDER_NOT_FOUND", "INVALID_ORDER", "INVALID_TRANSITION", "PAYMENT_REQUIRED", "STOCK_NOT_DEDUCTED", "ORDER_CANCELLED", "CURRENCY_MISMATCH"]),
  deduct: httpErrorSchema(["ORDER_NOT_FOUND", "INSUFFICIENT_STOCK", "ORDER_CANCELLED", "INVALID_ORDER"]),
  get: getErrorSchema,
  aggregate: getErrorSchema,
  list: commonErrorSchema,
  mixed: commonErrorSchema,
  catalog: commonErrorSchema,
  contacts: commonErrorSchema,
} satisfies Record<Operation, z.ZodType>;

function requestError(error: TransportError, operation: Operation): OrderRequestError {
  if (error.http) {
    const parsed = errorSchemas[operation].safeParse(error.http);
    if (parsed.success) {
      const { code, error: message, issues } = parsed.data.body;
      return { code, message, ...(issues ? { issues } : {}) };
    }
    if (error.code === "API_ERROR" || orderApiErrorSchema.safeParse(error.http.body).success) {
      return { code: "INVALID_RESPONSE", message: "Unexpected order error" };
    }
  }
  return { code: error.code, message: error.message };
}

function response<T extends z.ZodType>(raw: Result<unknown, TransportError>, schema: T, operation: Operation): Result<z.infer<T>, OrderRequestError> {
  if (!raw.success) return err(requestError(raw.error, operation));
  const parsed = schema.safeParse(raw.data);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid order response" });
}

export function createOrderApi(request: Request) {
  const fulfill = async (orderId: string, operation: "ship" | "deliver"): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
    if (!z.uuid().safeParse(orderId).success) return err({ code: "INVALID_INPUT", message: "Invalid order ID" });
    const result = response(await request(`/api/orders/${orderId}/${operation}`, { method: "POST" }), orderAggregateSchema, "fulfillment");
    return result.success && (result.data.id !== orderId || result.data.deliveryStatus !== (operation === "ship" ? "shipped" : "delivered"))
      ? err({ code: "INVALID_RESPONSE", message: "Unexpected order fulfillment" }) : result;
  };
  return {
    ship: (orderId: string) => fulfill(orderId, "ship"),
    deliver: (orderId: string) => fulfill(orderId, "deliver"),
    setDelivery: async (orderId: string, input: SetOrderDeliveryRequest): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
      const parsed = setOrderDeliverySchema.safeParse(input);
      if (!z.uuid().safeParse(orderId).success || !parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid delivery request" });
      const result = response(await request(`/api/orders/${orderId}/delivery`, { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data) }), orderAggregateSchema, "delivery");
      return result.success && (result.data.id !== orderId || result.data.delivery?.method !== parsed.data.delivery.method)
        ? err({ code: "INVALID_RESPONSE", message: "Unexpected assigned order delivery" }) : result;
    },
    enableCheckout: async (orderId: string): Promise<Result<Readonly<{ url: string }>, OrderRequestError>> => {
      if (!z.uuid().safeParse(orderId).success) return err({ code: "INVALID_INPUT", message: "Invalid order ID" });
      return response(await request(`/api/orders/${orderId}/checkout-link`, { method: "POST" }), checkoutLinkSchema, "checkout");
    },
    receiptUrl: async (imageId: string): Promise<Result<string, OrderRequestError>> => {
      if (!z.uuid().safeParse(imageId).success) return err({ code: "INVALID_INPUT", message: "Invalid receipt ID" });
      const raw = await request(`/api/images/${imageId}`);
      if (!raw.success) return raw;
      const parsed = imageResponseSchema.safeParse(raw.data);
      return parsed.success ? ok(parsed.data.url) : err({ code: "INVALID_RESPONSE", message: "Invalid receipt URL" });
    },
    voidPayment: async (orderId: string, paymentId: string): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
      if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(paymentId).success)
        return err({ code: "INVALID_INPUT", message: "Invalid payment ID" });
      return response(await request(`/api/orders/${orderId}/payments/${paymentId}/void`, { method: "POST" }), orderAggregateSchema, "void");
    },
    registerPayment: async (orderId: string, input: RegisterPaymentRequest): Promise<Result<z.infer<typeof registerPaymentResponseSchema>, OrderRequestError>> => {
      const parsed = registerPaymentSchema.safeParse(input);
      if (!z.uuid().safeParse(orderId).success || !parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid payment request" });
      return response(await request(`/api/orders/${orderId}/payments`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data) }), registerPaymentResponseSchema, "payment");
    },
    deductStock: async (orderId: string): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
      if (!z.uuid().safeParse(orderId).success) return err({ code: "INVALID_INPUT", message: "Invalid order ID" });
      return response(await request(`/api/orders/${orderId}/deduct-stock`, { method: "POST" }), orderAggregateSchema, "deduct");
    },
    listAggregates: async (input: ListOrderAggregatesRequest): Promise<Result<z.infer<typeof listOrderAggregatesResponseSchema>, OrderRequestError>> => {
      const parsed = listOrderAggregatesSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid order filters" });
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed.data)) if (value !== undefined) query.set(key, String(value));
      return response(await request(`/api/orders/mixed?${query}`), listOrderAggregatesResponseSchema, "mixed");
    },
    getAggregate: async (id: OrderAggregateResponse["id"]): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
      if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_INPUT", message: "Invalid order ID" });
      return response(await request(`/api/orders/${id}/aggregate`), orderAggregateSchema, "aggregate");
    },
    list: async (input: ListOrdersRequest): Promise<Result<z.infer<typeof listOrdersResponseSchema>, OrderRequestError>> => {
      const parsed = listOrdersSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid order filters" });
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed.data)) if (value !== undefined) query.set(key, String(value));
      return response(await request(`/api/orders?${query}`), listOrdersResponseSchema, "list");
    },
    get: async (id: OrderAggregateResponse["id"]): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
      if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_INPUT", message: "Invalid order ID" });
      return response(await request(`/api/orders/${id}/aggregate`), orderAggregateSchema, "get");
    },
    create: async (input: CreateOrderRequest): Promise<Result<OrderAggregateResponse, OrderRequestError>> => {
      const parsed = createOrderSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid order request" });
      return response(await request("/api/orders", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data) }), orderAggregateSchema, "create");
    },
    searchCatalog: async (search: string): Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>> =>
      response(await request(`/api/orders/catalog?${new URLSearchParams({ search })}`), orderCatalogSchema, "catalog"),
    searchContacts: async (search: string): Promise<Result<z.infer<typeof orderContactsSchema>, OrderRequestError>> =>
      response(await request(`/api/orders/contacts?${new URLSearchParams({ search })}`), orderContactsSchema, "contacts"),
  };
}
