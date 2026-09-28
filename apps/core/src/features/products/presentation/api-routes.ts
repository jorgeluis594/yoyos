import express, { type Request, type Response } from "express";
import { createProductRequestSchema, productApiIssueSchema, productListQuerySchema, updateProductRequestSchema } from "@shared/contracts/products";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";
import { products } from "@core/src/features/products/composition";
import { toProductDetailResponse, toProductIdResponse, toProductListResponse } from "@core/src/features/products/presentation/product-presenter";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sendInvalid = (response: Response, field: string, reason = "INVALID_TYPE") =>
  apiError(response, 400, "INVALID_INPUT", "Invalid input", [{ field, reason }]);

function zodIssues(error: { issues: readonly { path: PropertyKey[]; code: string; keys?: string[] }[] }) {
  return error.issues.flatMap((issue) => issue.code === "unrecognized_keys" && issue.keys?.length
    ? issue.keys.map((key) => ({ field: [...issue.path, key].join("."), reason: "UNKNOWN_FIELD" }))
    : [{ field: issue.path.join(".") || "body", reason: issue.code === "invalid_format" ? "INVALID_FORMAT" : "INVALID_TYPE" }]);
}

function domainIssues(issues: readonly object[]) {
  return issues.map((issue) => {
    const item = issue as Record<string, unknown>;
    return productApiIssueSchema.parse({
      ...(item.scope === undefined ? {} : { scope: item.scope }),
      field: String(item.field ?? "body"),
      ...(item.index === undefined ? {} : { index: item.index }),
      ...(item.message === undefined ? {} : { message: item.message }),
      reason: String(item.reason ?? "INVALID_INPUT"),
      ...(item.maxLength === undefined ? {} : { maxLength: item.maxLength }),
      ...(item.minimum === undefined ? {} : { minimum: item.minimum }),
      ...(item.maximum === undefined ? {} : { maximum: item.maximum }),
      ...(item.maxDecimals === undefined ? {} : { maxDecimals: item.maxDecimals }),
    });
  });
}

function sendOperationError(response: Response, error: { code?: string; issues?: readonly object[] }) {
  switch (error.code) {
    case "VALIDATION_ERROR": return apiError(response, 422, "VALIDATION_ERROR", "Invalid product", domainIssues(error.issues ?? []));
    case "DUPLICATE_SKU": return apiError(response, 409, "DUPLICATE_SKU", "SKU is already used");
    case "PRODUCT_ID_CONFLICT": return apiError(response, 409, "PRODUCT_ID_CONFLICT", "Product ID is already used");
    case "PRODUCT_NOT_FOUND": return apiError(response, 404, "PRODUCT_NOT_FOUND", "Product not found");
    case "IMAGE_NOT_FOUND": return apiError(response, 404, "IMAGE_NOT_FOUND", "Image not found");
    case "PERSISTENCE_UNAVAILABLE": return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
    case "INVALID_STORED_DATA":
      console.error("Invalid stored product data", error);
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
    default:
      console.error("Product API application error", error);
      return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
  }
}

function handleUnexpected(response: Response, error: unknown) {
  console.error("Product API operation failed", error);
  return apiError(response, 500, "INTERNAL_ERROR", "Internal error");
}

function productIdFrom(request: Request, response: Response): ProductId | null {
  const id = request.params.productId;
  if (typeof id !== "string" || !uuid.test(id)) {
    sendInvalid(response, "productId", "INVALID_FORMAT");
    return null;
  }
  return id as ProductId;
}

export const productRoutes = express.Router();

productRoutes.get("/", async (request, response) => {
  const searchParams = new URL(request.originalUrl, "http://localhost").searchParams;
  const values: Record<string, string> = {};
  for (const key of searchParams.keys()) {
    const all = searchParams.getAll(key);
    if (all.length !== 1) return sendInvalid(response, key, "DUPLICATE_FIELD");
    values[key] = all[0];
  }
  const parsed = productListQuerySchema.safeParse(values);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid query", zodIssues(parsed.error));
  try {
    const result = await products.list(parsed.data);
    if (!result.success) return sendOperationError(response, result.error);
    return response.json(toProductListResponse(result.data));
  } catch (error) {
    return handleUnexpected(response, error);
  }
});

productRoutes.get("/:productId", async (request, response) => {
  const id = productIdFrom(request, response);
  if (!id) return;
  try {
    const result = await products.get(id);
    if (!result.success) {
      if (result.error.code === "IMAGE_NOT_FOUND") {
        console.error("Product image reference could not be resolved", id);
        return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
      }
      return sendOperationError(response, result.error);
    }
    if (!result.data) return apiError(response, 404, "PRODUCT_NOT_FOUND", "Product not found");
    return response.json(toProductDetailResponse(result.data));
  } catch (error) {
    return handleUnexpected(response, error);
  }
});

productRoutes.post("/", async (request, response) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const parsed = createProductRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid product input", zodIssues(parsed.error));
  try {
    const { id, ...input } = parsed.data;
    const [firstVariant, ...remainingVariants] = input.variants;
    const result = await products.create({
      id: id as ProductId,
      name: input.name,
      currency: input.currency,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.imageId === undefined ? {} : { imageId: input.imageId as ImageId }),
      variants: [firstVariant, ...remainingVariants],
    });
    if (!result.success) return sendOperationError(response, result.error);
    return response.status(201).json(toProductIdResponse(result.data));
  } catch (error) {
    return handleUnexpected(response, error);
  }
});

productRoutes.patch("/:productId", async (request, response) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const id = productIdFrom(request, response);
  if (!id) return;
  const parsed = updateProductRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid product input", zodIssues(parsed.error));
  try {
    const input = {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
      ...(parsed.data.imageId === undefined ? {} : { imageId: parsed.data.imageId === null ? null : parsed.data.imageId as ImageId }),
      ...(parsed.data.variants === undefined ? {} : { variants: parsed.data.variants.map((variant) => ({
        ...variant, id: variant.id as VariantId,
      })) }),
    };
    const result = await products.update(id, input);
    if (!result.success) return sendOperationError(response, result.error);
    return response.json(toProductIdResponse(result.data));
  } catch (error) {
    return handleUnexpected(response, error);
  }
});
