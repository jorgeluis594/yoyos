import express from "express";
import { createProductRequestSchema, productListQuerySchema, saveProductRequestSchema, updateProductRequestSchema, type SaveProductRequest } from "@shared/contracts/products";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";
import { products } from "@core/src/features/products/composition";
import { productEditing } from "@core/src/composition/product-editing";
import { handleUnexpected, productIdFrom, sendInvalid, sendOperationError, zodIssues } from "@core/src/features/products/presentation/api-errors";
import type { ImageId, ProductId, VariantId } from "@core/src/features/products/domain/product";
import type { SaveProductInput } from "@core/src/features/products/application/save-product";
import { toCreateInput, toUpdateInput } from "@core/src/features/products/presentation/request-input";
import { toProductDetailResponse, toProductIdResponse, toProductListResponse } from "@core/src/features/products/presentation/product-presenter";

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
    const result = await productEditing.list(parsed.data, { includeImages: true });
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
    const result = await productEditing.get(id);
    if (!result.success) {
      if (result.error.code === "IMAGE_NOT_FOUND") {
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
    const result = await productEditing.create(toCreateInput(parsed.data));
    if (!result.success) return sendOperationError(response, result.error);
    return response.status(201).json(toProductIdResponse(result.data));
  } catch (error) {
    return handleUnexpected(response, error);
  }
});

function toSaveInput(productId: ProductId, request: SaveProductRequest): SaveProductInput {
  return {
    productId, structureVersion: request.structureVersion, name: request.name, description: request.description, imageId: request.imageId as ImageId | null,
    options: request.options,
    variants: request.variants.map((variant) => ({ ...variant, id: variant.id as VariantId })),
    newVariants: request.newVariants,
    deletedVariantIds: request.deletedVariantIds as VariantId[],
  };
}

productRoutes.put("/:productId", async (request, response) => {
  if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
  const id = productIdFrom(request, response);
  if (!id) return;
  const parsed = saveProductRequestSchema.safeParse(request.body);
  if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid product input", zodIssues(parsed.error));
  try {
    const result = await productEditing.save(toSaveInput(id, parsed.data));
    if (!result.success) return sendOperationError(response, result.error);
    return response.json(toProductDetailResponse(result.data));
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
    const result = await products.update(id, toUpdateInput(parsed.data));
    if (!result.success) return sendOperationError(response, result.error);
    return response.json(toProductIdResponse(result.data));
  } catch (error) {
    return handleUnexpected(response, error);
  }
});
