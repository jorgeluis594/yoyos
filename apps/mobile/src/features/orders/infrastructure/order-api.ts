import { z } from "zod";
import { createOrderSchema, listOrdersResponseSchema, listOrdersSchema, orderApiErrorSchema,
  orderCatalogSchema, orderContactsSchema, orderSchema, type CreateOrderRequest, type ListOrdersRequest,
  type OrderApiError, type OrderApiIssue, type OrderResponse } from "@shared/contracts/orders";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type OrderRequestError = Readonly<{
  code: OrderApiError["code"] | TransportError["code"];
  message: string;
  issues?: readonly OrderApiIssue[];
}>;

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
type Operation = "list" | "get" | "create" | "catalog" | "contacts";

const statusByCode: Record<OrderApiError["code"], number> = {
  INVALID_INPUT: 400, UNSUPPORTED_MEDIA_TYPE: 415, PAYLOAD_TOO_LARGE: 413,
  INVALID_ORDER: 422, CURRENCY_MISMATCH: 422, CONTACT_NOT_FOUND: 404, VARIANT_NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409, ORDER_ALREADY_EXISTS: 409, ORDER_NOT_FOUND: 404, SERVICE_UNAVAILABLE: 503,
};
const createCodes = new Set<OrderApiError["code"]>(["INVALID_ORDER", "CURRENCY_MISMATCH", "CONTACT_NOT_FOUND",
  "VARIANT_NOT_FOUND", "INSUFFICIENT_STOCK", "ORDER_ALREADY_EXISTS", "UNSUPPORTED_MEDIA_TYPE", "PAYLOAD_TOO_LARGE"]);

function requestError(error: TransportError, operation: Operation): OrderRequestError {
  if (error.http) {
    const parsed = orderApiErrorSchema.safeParse(error.http.body);
    if (parsed.success) {
      const { code, issues } = parsed.data;
      const allowed = ["INVALID_INPUT", "SERVICE_UNAVAILABLE"].includes(code)
        || operation === "create" && createCodes.has(code)
        || operation === "get" && code === "ORDER_NOT_FOUND";
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
    list: async (input: ListOrdersRequest): Promise<Result<z.infer<typeof listOrdersResponseSchema>, OrderRequestError>> => {
      const parsed = listOrdersSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid order filters" });
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed.data)) if (value !== undefined) query.set(key, String(value));
      return response(await request(`/api/orders?${query}`), listOrdersResponseSchema, "list");
    },
    get: async (id: OrderResponse["id"]): Promise<Result<OrderResponse, OrderRequestError>> => {
      if (!z.uuid().safeParse(id).success) return err({ code: "INVALID_INPUT", message: "Invalid order ID" });
      return response(await request(`/api/orders/${id}`), orderSchema, "get");
    },
    create: async (input: CreateOrderRequest): Promise<Result<OrderResponse, OrderRequestError>> => {
      const parsed = createOrderSchema.safeParse(input);
      if (!parsed.success) return err({ code: "INVALID_INPUT", message: "Invalid order request" });
      return response(await request("/api/orders", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data) }), orderSchema, "create");
    },
    searchCatalog: async (search: string): Promise<Result<z.infer<typeof orderCatalogSchema>, OrderRequestError>> =>
      response(await request(`/api/orders/catalog?${new URLSearchParams({ search })}`), orderCatalogSchema, "catalog"),
    searchContacts: async (search: string): Promise<Result<z.infer<typeof orderContactsSchema>, OrderRequestError>> =>
      response(await request(`/api/orders/contacts?${new URLSearchParams({ search })}`), orderContactsSchema, "contacts"),
  };
}
