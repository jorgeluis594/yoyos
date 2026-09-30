import { log } from "@core/src/shared/infrastructure/logger";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { createOrderSchema, listOrdersSchema, orderCatalogSchema, orderContactsSchema } from "@shared/contracts/orders";
import { apiError, type PrivateLocals } from "@core/src/shared/infrastructure/api-auth-middleware";
import { orders } from "@core/src/features/orders/composition";
import { toOrderJson, toOrderListJson } from "@core/src/features/orders/presentation/order-json";
import type { ContactId } from "@core/src/features/orders/domain/order";

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
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    default:
      log.error({ event: "unexpected_order_error", err: error }, "unexpected_order_error");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

function unexpected(response: Response, error: unknown) {
  log.error({ event: "order_api_operation_failed", err: error }, "order_api_operation_failed");
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

export const orderRoutes = express.Router();

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

orderRoutes.get("/:id", async (request, response) => {
  const parsed = z.uuid().safeParse(request.params.id);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order ID");
  try {
    const result = await orders.get(parsed.data);
    return result.success ? response.json(toOrderJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});

orderRoutes.post("/", async (request, response: Response<unknown, PrivateLocals>) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = createOrderSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid order input");
  try {
    const result = await orders.create(parsed.data, { companyId: response.locals.auth.company.id, sellerId: response.locals.auth.user.id });
    return result.success ? response.status(201).json(toOrderJson(result.data)) : operationError(response, result.error);
  } catch (error) { return unexpected(response, error); }
});
