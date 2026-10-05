import { z } from "zod";
import { createOrderSchema, listOrderAggregatesResponseSchema, listOrderAggregatesSchema, listOrdersResponseSchema, listOrdersSchema, orderAggregateSchema, orderApiErrorSchema,
  orderCatalogSchema, orderContactsSchema, registerPaymentResponseSchema, registerPaymentSchema, type CreateOrderRequest, type ListOrderAggregatesRequest, type ListOrdersRequest, type RegisterPaymentRequest,
  type OrderAggregateResponse, type OrderApiError, type OrderApiIssue } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import { imageResponseSchema } from "@shared/contracts/images";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type OrderRequestError = Readonly<{
  code: OrderApiError["code"] | TransportError["code"];
  message: string;
  issues?: readonly OrderApiIssue[];
}>;

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
type Operation = "list" | "mixed" | "get" | "aggregate" | "create" | "payment" | "void" | "deduct" | "catalog" | "contacts";

const statusByCode: Record<OrderApiError["code"], number> = {
  INVALID_INPUT: 400, UNSUPPORTED_MEDIA_TYPE: 415, PAYLOAD_TOO_LARGE: 413,
  INVALID_ORDER: 422, CURRENCY_MISMATCH: 422, CONTACT_NOT_FOUND: 404, VARIANT_NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409, ORDER_ALREADY_EXISTS: 409, ORDER_NOT_FOUND: 404, SERVICE_UNAVAILABLE: 503,
  INVALID_PAYMENT: 422, PAYMENT_CONFLICT: 409, PAYMENT_NOT_FOUND: 404, RECEIPT_NOT_FOUND: 422, INVALID_TRANSITION: 409, DELIVERY_LOCKED: 409,
  PAYMENT_REQUIRED: 409, STOCK_NOT_DEDUCTED: 409, ORDER_CANCELLED: 409, DELIVERY_UNAVAILABLE: 422,
};
const createCodes = new Set<OrderApiError["code"]>(["INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND",
  "VARIANT_NOT_FOUND", "INSUFFICIENT_STOCK", "ORDER_ALREADY_EXISTS", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]);
const paymentCodes = new Set<OrderApiError["code"]>(["ORDER_NOT_FOUND", "INVALID_ORDER", "INVALID_PAYMENT", "CURRENCY_MISMATCH",
  "PAYMENT_CONFLICT", "PAYMENT_NOT_FOUND", "INVALID_TRANSITION", "ORDER_CANCELLED", "INSUFFICIENT_STOCK", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]);

function requestError(error: TransportError, operation: Operation): OrderRequestError {
  if (error.http) {
    const parsed = orderApiErrorSchema.safeParse(error.http.body);
    if (parsed.success) {
      const { code, issues } = parsed.data;
      const allowed = ["INVALID_INPUT", "SERVICE_UNAVAILABLE"].includes(code)
        || operation === "create" && createCodes.has(code)
        || operation === "payment" && paymentCodes.has(code)
        || operation === "void" && ["ORDER_NOT_FOUND", "PAYMENT_NOT_FOUND", "PAYMENT_CONFLICT", "INVALID_TRANSITION", "INVALID_ORDER"].includes(code)
        || operation === "deduct" && ["ORDER_NOT_FOUND", "INSUFFICIENT_STOCK", "ORDER_CANCELLED", "INVALID_ORDER"].includes(code)
        || (operation === "get" || operation === "aggregate") && code === "ORDER_NOT_FOUND";
      if (statusByCode[code] === error.http.status && allowed) return { code, message: parsed.data.error, ...(issues ? { issues } : {}) };
      return { code: "INVALID_RESPONSE", message: "Unexpected order error" };
    }
    if (error.code === "API_ERROR") return { code: "INVALID_RESPONSE", message: "Unexpected order error" };
  }
  return { code: error.code, message: error.message };
}

function response<T extends z.ZodType>(raw: Result<unknown, TransportError>, schema: T, operation: Operation): Result<z.infer<T>, OrderRequestError> {
  if (!raw.success) return err(requestError(raw.error, operation));
  const parsed = schema.safeParse(raw.data);
  return parsed.success ? ok(parsed.data) : err({ code: "INVALID_RESPONSE", message: "Invalid order response" });
}

export function createOrderApi(request: Request) {
  return {
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
