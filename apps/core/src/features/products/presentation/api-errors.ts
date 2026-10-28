import { log } from "@core/src/shared/infrastructure/logger";
import type { Request, Response } from "express";
import { productApiIssueSchema, productIssueReasonSchema } from "@shared/contracts/products";
import type { ProductId } from "@core/src/features/products/domain/product";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sendInvalid = (response: Response, field: string, reason = "INVALID_TYPE") =>
  apiError(response, 400, "INVALID_INPUT", "Invalid input", [{ field, reason }]);

export function zodIssues(error: { issues: readonly { path: PropertyKey[]; code: string; keys?: string[] }[] }) {
  return error.issues.flatMap((issue) => issue.code === "unrecognized_keys" && issue.keys?.length
    ? issue.keys.map((key) => ({ field: [...issue.path, key].join("."), reason: "UNKNOWN_FIELD" }))
    : [{ field: issue.path.join(".") || "body", reason: issue.code === "invalid_format" ? "INVALID_FORMAT" : "INVALID_TYPE" }]);
}

const passthrough = ["scope", "index", "optionIndex", "optionId", "valueIndex", "valueId", "variantId", "message", "maximum", "maxLength", "minimum", "maxDecimals"] as const;

/** Domain issues as the wire shape. A reason outside `productIssueReasonSchema` is a bug and fails loudly. */
export function domainIssues(issues: readonly object[]) {
  return issues.map((issue) => {
    const item = issue as Record<string, unknown>;
    return productApiIssueSchema.parse({
      field: String(item.field ?? "body"),
      reason: productIssueReasonSchema.parse(item.reason ?? "INVALID_INPUT"),
      ...Object.fromEntries(passthrough.filter((key) => item[key] !== undefined).map((key) => [key, item[key]])),
    });
  });
}

/** Every business or technical outcome of a product operation as its HTTP answer (§8.2). */
export function sendOperationError(response: Response, error: { code?: string; issues?: readonly object[] }) {
  switch (error.code) {
    case "VALIDATION_ERROR": return apiError(response, 422, "VALIDATION_ERROR", "Invalid product", domainIssues(error.issues ?? []));
    case "DUPLICATE_SKU": return apiError(response, 409, "DUPLICATE_SKU", "SKU is already used");
    case "PRODUCT_ID_CONFLICT": return apiError(response, 409, "PRODUCT_ID_CONFLICT", "Product ID is already used");
    case "ID_CONFLICT": return apiError(response, 409, "ID_CONFLICT", "Identifier is already used");
    case "PRODUCT_CHANGED": return apiError(response, 409, "PRODUCT_CHANGED", "Product changed since it was loaded");
    case "DUPLICATE_COMBINATION": return apiError(response, 409, "DUPLICATE_COMBINATION", "Combination is already used");
    case "VARIANT_HAS_ORDERS": return apiError(response, 409, "VARIANT_HAS_ORDERS", "Variant has orders");
    case "VARIANT_HAS_STOCK": return apiError(response, 409, "VARIANT_HAS_STOCK", "Variant has stock");
    case "LAST_VARIANT": return apiError(response, 409, "LAST_VARIANT", "Product needs at least one variant");
    case "PRODUCT_WITHOUT_OPTIONS": return apiError(response, 409, "PRODUCT_WITHOUT_OPTIONS", "Product has no options");
    case "PRODUCT_NOT_FOUND": return apiError(response, 404, "PRODUCT_NOT_FOUND", "Product not found");
    case "VARIANT_NOT_FOUND": return apiError(response, 404, "VARIANT_NOT_FOUND", "Variant not found");
    // Only the editing read raises it (a stored photo whose URL cannot be built), never a write rejection: it is an outage, not a client error.
    case "IMAGE_NOT_FOUND": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "INVALID_STORED_DATA":
      log.error({ event: "invalid_stored_product_data", err: error }, "invalid_stored_product_data");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    default:
      log.error({ event: "product_api_application_error", err: error }, "product_api_application_error");
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

export function handleUnexpected(response: Response, error: unknown) {
  log.error({ event: "product_api_operation_failed", err: error }, "product_api_operation_failed");
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

export function productIdFrom(request: Request, response: Response): ProductId | null {
  const id = request.params.productId;
  if (typeof id !== "string" || !uuid.test(id)) {
    sendInvalid(response, "productId", "INVALID_FORMAT");
    return null;
  }
  return id as ProductId;
}
