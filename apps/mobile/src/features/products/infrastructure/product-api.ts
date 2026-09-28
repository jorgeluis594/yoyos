import {
  createProductRequestSchema,
  productApiErrorSchema,
  productDetailResponseSchema,
  productIdResponseSchema,
  productListResponseSchema,
  updateProductRequestSchema,
  type CreateProductRequest,
  type UpdateProductRequest,
} from "@shared/contracts/products";
import { imageResponseSchema } from "@shared/contracts/images";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { TransportError } from "@/shared/application/transport-error";
import type { ImageId, Product, ProductId, ProductListCriteria, ProductPage, VariantId } from "../domain/product";

type ProductIssue = Readonly<{ field: string; reason: string; message?: string; scope?: string; index?: number; maxLength?: number }>;
type MobileTransportCode = Extract<TransportError["code"], "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE" | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR" | "API_ERROR">;
type ProductTransportFailure = Readonly<{ code: MobileTransportCode; message: string }>;
type ApiFailure =
  | Readonly<{ code: "INVALID_INPUT"; message: string; issues?: readonly ProductIssue[] }>
  | Readonly<{ code: "VALIDATION_ERROR"; message: string; issues?: readonly ProductIssue[] }>
  | Readonly<{ code: "DUPLICATE_SKU"; message: string }>
  | Readonly<{ code: "PRODUCT_ID_CONFLICT"; message: string }>
  | Readonly<{ code: "PRODUCT_NOT_FOUND"; message: string }>
  | Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }>
  | Readonly<{ code: "PAYLOAD_TOO_LARGE"; message: string }>
  | Readonly<{ code: "UNSUPPORTED_MEDIA_TYPE"; message: string }>
  | Readonly<{ code: "INVALID_IMAGE"; message: string }>
  | Readonly<{ code: "IMAGE_TOO_LARGE"; message: string }>
  | Readonly<{ code: "IMAGE_STORAGE_UNAVAILABLE"; message: string }>;
export type ProductListCriteriaIssue = Readonly<{ field: "search" | "page" | "pageSize"; reason: "INVALID_TYPE" | "INVALID_RANGE" | "UNSAFE_PAGINATION"; message: string }>;
export type ProductListInputIssue = Readonly<{ field: string; reason: "INVALID_TYPE" | "UNKNOWN_FIELD" | "DUPLICATE_FIELD" }>;
export type ListProductsError = ProductTransportFailure
  | Readonly<{ code: "INVALID_INPUT"; message: string; issues: readonly [ProductListInputIssue, ...ProductListInputIssue[]] }>
  | Readonly<{ code: "VALIDATION_ERROR"; message: string; issues: readonly [ProductListCriteriaIssue, ...ProductListCriteriaIssue[]] }>;
export type GetProductError = ProductTransportFailure | Extract<ApiFailure, { code: "PRODUCT_NOT_FOUND" }>;
export type CreateProductError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_SKU" | "PRODUCT_ID_CONFLICT" | "IMAGE_NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" }>;
export type UpdateProductError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_SKU" | "PRODUCT_NOT_FOUND" | "IMAGE_NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" }>;
export type UploadProductImageError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "IMAGE_STORAGE_UNAVAILABLE" }>;

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

function fieldFailure(code: MobileTransportCode, message: string): ProductTransportFailure {
  return { code, message };
}

function readApiFailure(error: TransportError, allowed: readonly string[]): ApiFailure | ProductTransportFailure {
  if (error.http?.status === 429) return fieldFailure("RATE_LIMITED", error.message);
  if (!error.http) {
    const transportCodes: readonly string[] = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "NETWORK_ERROR", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "SERVER_ERROR", "INVALID_RESPONSE", "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR", "API_ERROR"];
    return fieldFailure(transportCodes.includes(error.code) ? error.code as MobileTransportCode : "API_ERROR", error.message);
  }
  const parsed = productApiErrorSchema.safeParse(error.http.body);
  if (!parsed.success) return fieldFailure("INVALID_RESPONSE", "Server returned an invalid error");
  if (!allowed.includes(parsed.data.code)) return fieldFailure("API_ERROR", "The request could not be completed");
  const expectedStatus: Record<string, number> = {
    INVALID_INPUT: 400, VALIDATION_ERROR: 422, DUPLICATE_SKU: 409, PRODUCT_ID_CONFLICT: 409,
    PRODUCT_NOT_FOUND: 404, IMAGE_NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415, UNAUTHENTICATED: 401, COMPANY_REQUIRED: 409,
    SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500, INVALID_IMAGE: 400, IMAGE_TOO_LARGE: 413,
    IMAGE_STORAGE_UNAVAILABLE: 502,
  };
  if (expectedStatus[parsed.data.code] !== error.http.status) {
    return fieldFailure("INVALID_RESPONSE", "Server returned an invalid error");
  }
  if (parsed.data.code === "UNAUTHENTICATED") return fieldFailure("UNAUTHENTICATED", "Sign in to continue");
  if (parsed.data.code === "COMPANY_REQUIRED") return fieldFailure("COMPANY_REQUIRED", "Select a company to continue");
  if (parsed.data.code === "SERVICE_UNAVAILABLE") return fieldFailure("SERVICE_UNAVAILABLE", "Service unavailable");
  if (parsed.data.code === "INTERNAL_ERROR") return fieldFailure("SERVER_ERROR", "The service could not complete the request");
  return {
    code: parsed.data.code as ApiFailure["code"],
    message: "The product request failed",
    ...(parsed.data.issues === undefined ? {} : { issues: parsed.data.issues }),
  };
}

const transportCodes: readonly string[] = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "NETWORK_ERROR", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "SERVER_ERROR", "INVALID_RESPONSE", "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR", "API_ERROR"];
function restrictFailure<E extends ApiFailure["code"]>(
  result: Result<unknown, ApiFailure | ProductTransportFailure>,
  allowed: readonly E[],
): Result<unknown, Extract<ApiFailure, { code: E }> | ProductTransportFailure> {
  if (result.success) return result;
  if (transportCodes.includes(result.error.code)) return err(result.error as ProductTransportFailure);
  if (allowed.includes(result.error.code as E)) return err(result.error as Extract<ApiFailure, { code: E }>);
  return err(fieldFailure("INVALID_RESPONSE", "Server returned an unexpected product error"));
}

function productListItem(item: ReturnType<typeof productListResponseSchema.parse>["items"][number]) {
  return {
    id: item.id as ProductId,
    name: item.name,
    variantCount: item.variantCount,
    ...(item.sku === undefined ? {} : { sku: item.sku }),
    price: item.minSalePrice,
    priceFrom: item.hasDifferentPrices,
    stock: item.totalStock,
  };
}

function listError(error: Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" }>): ListProductsError {
  if (error.code === "INVALID_INPUT") {
    const issues = (error.issues ?? []).map((issue): ProductListInputIssue => ({
      field: issue.field,
      reason: issue.reason === "UNKNOWN_FIELD" || issue.reason === "DUPLICATE_FIELD" ? issue.reason : "INVALID_TYPE",
    }));
    return issues.length ? { code: error.code, message: error.message, issues: issues as [ProductListInputIssue, ...ProductListInputIssue[]] }
      : fieldFailure("INVALID_RESPONSE", "Server returned an invalid query error");
  }
  const fields = ["search", "page", "pageSize"] as const;
  const reasons = ["INVALID_TYPE", "INVALID_RANGE", "UNSAFE_PAGINATION"] as const;
  const issues = (error.issues ?? []).map((issue): ProductListCriteriaIssue | null =>
    fields.includes(issue.field as ProductListCriteriaIssue["field"]) && reasons.includes(issue.reason as ProductListCriteriaIssue["reason"])
      ? { field: issue.field as ProductListCriteriaIssue["field"], reason: issue.reason as ProductListCriteriaIssue["reason"], message: issue.message ?? "Invalid listing criteria" }
      : null,
  );
  if (!issues.length || issues.some((issue) => issue === null)) return fieldFailure("INVALID_RESPONSE", "Server returned invalid listing criteria");
  return { code: error.code, message: error.message, issues: issues as [ProductListCriteriaIssue, ...ProductListCriteriaIssue[]] };
}

function productDetail(dto: ReturnType<typeof productDetailResponseSchema.parse>): Product {
  return {
    id: dto.product.id as ProductId,
    name: dto.product.name,
    ...(dto.product.description === undefined ? {} : { description: dto.product.description }),
    currency: dto.product.currency,
    ...(dto.image === undefined ? {} : { photo: { id: dto.image.id as ImageId, url: dto.image.url } }),
    variants: dto.product.variants.map((variant) => ({
      id: variant.id as VariantId,
      attributes: variant.attributes,
      ...(variant.sku === undefined ? {} : { sku: variant.sku }),
      salePrice: variant.salePrice,
      ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice }),
      stock: variant.stock.quantity,
    })),
  };
}

export function createProductApi(request: Request) {
  const run = async (path: string, init: RequestInit, allowed: readonly string[]) => {
    const result = await request(path, init);
    return result.success ? result : err(readApiFailure(result.error, allowed));
  };
  return {
    async list(criteria: ProductListCriteria): Promise<Result<ProductPage, ListProductsError>> {
      const params = new URLSearchParams({ page: String(criteria.page), pageSize: String(criteria.pageSize) });
      const search = criteria.search?.trim();
      if (search) params.set("search", search);
      const result = restrictFailure(await run(`/api/products?${params}`, {}, ["INVALID_INPUT", "VALIDATION_ERROR", "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), ["INVALID_INPUT", "VALIDATION_ERROR"] as const);
      if (!result.success) {
        if (result.error.code === "INVALID_INPUT" || result.error.code === "VALIDATION_ERROR") return err(listError(result.error));
        return err(result.error);
      }
      const parsed = productListResponseSchema.safeParse(result.data);
      return parsed.success
        ? ok({ ...parsed.data, items: parsed.data.items.map(productListItem) })
        : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid products"));
    },
    async get(id: ProductId): Promise<Result<Product, GetProductError>> {
      const result = restrictFailure(await run(`/api/products/${encodeURIComponent(id)}`, {}, ["PRODUCT_NOT_FOUND", "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), ["PRODUCT_NOT_FOUND"] as const);
      if (!result.success) return result;
      const parsed = productDetailResponseSchema.safeParse(result.data);
      return parsed.success ? ok(productDetail(parsed.data)) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product data"));
    },
    async create(input: CreateProductRequest): Promise<Result<ProductId, CreateProductError>> {
      const body = createProductRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "INVALID_INPUT", message: "Invalid product input" });
      const result = restrictFailure(await run("/api/products", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body.data),
      }, ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "PRODUCT_ID_CONFLICT", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "PRODUCT_ID_CONFLICT", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"] as const);
      if (!result.success) return result;
      const parsed = productIdResponseSchema.safeParse(result.data);
      return parsed.success ? ok(parsed.data.id as ProductId) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product ID"));
    },
    async uploadImage(uri: string): Promise<Result<Readonly<{ id: ImageId; url: string }>, UploadProductImageError>> {
      let file: Blob;
      try {
        const source = await fetch(uri).then((response) => response.blob());
        file = new Blob([source], { type: "image/jpeg" });
      } catch {
        return err(fieldFailure("NETWORK_ERROR", "Could not prepare the photo"));
      }
      const form = new FormData();
      form.append("file", file, "product.jpg");
      const result = restrictFailure(await run("/api/images", { method: "POST", body: form }, ["INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "IMAGE_STORAGE_UNAVAILABLE", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "UNAUTHENTICATED", "COMPANY_REQUIRED"]), ["INVALID_IMAGE", "IMAGE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "IMAGE_STORAGE_UNAVAILABLE"] as const);
      if (!result.success) return result;
      const parsed = imageResponseSchema.safeParse(result.data);
      return parsed.success
        ? ok({ id: parsed.data.id as ImageId, url: parsed.data.url })
        : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid image data"));
    },
    async update(id: ProductId, input: UpdateProductRequest): Promise<Result<ProductId, UpdateProductError>> {
      const body = updateProductRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "INVALID_INPUT", message: "Invalid product input" });
      const result = restrictFailure(await run(`/api/products/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body.data),
      }, ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "PRODUCT_NOT_FOUND", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "PRODUCT_NOT_FOUND", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"] as const);
      if (!result.success) return result;
      const parsed = productIdResponseSchema.safeParse(result.data);
      return parsed.success ? ok(parsed.data.id as ProductId) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product ID"));
    },
  };
}
