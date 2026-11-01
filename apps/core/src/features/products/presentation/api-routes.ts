import express from "express";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import { catalogSearchReadinessResponseSchema } from "@shared/contracts/catalog-search-readiness";
import { createProductRequestSchema, productListQuerySchema, saveProductRequestSchema } from "@shared/contracts/products";
import { getCompanyId } from "@core/src/shared/infrastructure/persistance";
import { apiError } from "@core/src/shared/infrastructure/api-auth-middleware";
import { productEditing } from "@core/src/features/products/product-editing";
import { resolveCatalogEmptied, type StorefrontReading } from "@core/src/features/products/presentation/catalog-emptied";
import { products } from "@core/src/features/products/composition";
import { handleUnexpected, productIdFrom, sendInvalid, sendOperationError, zodIssues } from "@core/src/features/products/presentation/api-errors";
import { toCreateInput, toSaveInput } from "@core/src/features/products/presentation/request-input";
import { toProductDetailResponse, toProductIdResponse, toProductListResponse, toSaveProductResponse } from "@core/src/features/products/presentation/product-presenter";

/** `describeStorefront` is injected by the application so products never imports catalog. */
export type ProductRouteDependencies = Readonly<{
  describeStorefront: (companyId: CompanyId) => Promise<Result<StorefrontReading, Readonly<{ code: string; message: string }>>>;
}>;

export function createProductRoutes({ describeStorefront }: ProductRouteDependencies) {
  const productRoutes = express.Router();

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

  productRoutes.get("/search-readiness", async (_request, response) => {
    try {
      const readiness = await products.catalogSearchReadiness();
      if (!readiness.success) return apiError(response, 503, "SERVICE_UNAVAILABLE", "Service unavailable");
      return response.json(catalogSearchReadinessResponseSchema.parse({ version: 1, state: readiness.data }));
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

  productRoutes.put("/:productId", async (request, response) => {
    if (!request.is("application/json")) return apiError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "JSON body required");
    const id = productIdFrom(request, response);
    if (!id) return;
    const parsed = saveProductRequestSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "INVALID_INPUT", "Invalid product input", zodIssues(parsed.error));
    try {
      const result = await productEditing.save(toSaveInput(id, parsed.data));
      if (!result.success) return sendOperationError(response, result.error);
      const catalogEmptied = await resolveCatalogEmptied(result.data, { companyId: getCompanyId() as CompanyId }, describeStorefront);
      return response.json(toSaveProductResponse(result.data.detail, catalogEmptied));
    } catch (error) {
      return handleUnexpected(response, error);
    }
  });

  return productRoutes;
}
