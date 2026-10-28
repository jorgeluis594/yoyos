import {
  createProductRequestSchema,
  productApiErrorCodeSchema,
  productApiErrorSchema,
  productDetailResponseSchema,
  productIdResponseSchema,
  productListResponseSchema,
  saveProductRequestSchema,
  updateVariantRequestSchema,
  changeCombinationRequestSchema,
  changeVariantStatusRequestSchema,
  type ChangeCombinationRequest,
  type CreateProductRequest,
  type SaveProductRequest,
  type UpdateVariantRequest,
} from "@shared/contracts/products";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { uploadImage, type UploadImageError } from "@mobile/shared/infrastructure/image-api";
import type { TransportError } from "@mobile/shared/application/transport-error";
import type { ImageId, OptionId, OptionValueId, Product, ProductId, ProductListCriteria, ProductPage, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";
import type { GetProductError } from "@mobile/features/products/application/product-printing";

export type ProductIssue = Readonly<{ field: string; reason: string; message?: string; scope?: string; index?: number; optionIndex?: number; optionId?: string; valueIndex?: number; valueId?: string; variantId?: string; maximum?: number; maxLength?: number }>;
type MobileTransportCode = Extract<TransportError["code"], "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE" | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR" | "API_ERROR">;
type ProductTransportFailure = Readonly<{ code: MobileTransportCode; message: string }>;
type ApiFailure =
  | Readonly<{ code: "INVALID_INPUT"; message: string; issues?: readonly ProductIssue[] }>
  | Readonly<{ code: "VALIDATION_ERROR"; message: string; issues?: readonly ProductIssue[] }>
  | Readonly<{ code: "DUPLICATE_SKU"; message: string }>
  | Readonly<{ code: "PRODUCT_ID_CONFLICT"; message: string }>
  | Readonly<{ code: "ID_CONFLICT"; message: string }>
  | Readonly<{ code: "DUPLICATE_COMBINATION"; message: string }>
  | Readonly<{ code: "PRODUCT_CHANGED"; message: string }>
  | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string }>
  | Readonly<{ code: "VARIANT_HAS_ORDERS"; message: string }>
  | Readonly<{ code: "VARIANT_HAS_STOCK"; message: string }>
  | Readonly<{ code: "LAST_VARIANT"; message: string }>
  | Readonly<{ code: "PRODUCT_WITHOUT_OPTIONS"; message: string }>
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
export type CreateProductError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_SKU" | "DUPLICATE_COMBINATION" | "PRODUCT_ID_CONFLICT" | "ID_CONFLICT" | "IMAGE_NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" }>;
export type SaveProductError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_SKU" | "DUPLICATE_COMBINATION" | "PRODUCT_CHANGED" | "ID_CONFLICT" | "VARIANT_HAS_ORDERS" | "PRODUCT_NOT_FOUND" | "IMAGE_NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" }>;
type VariantNotFound = "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND";
export type UpdateVariantError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_SKU" | VariantNotFound }>;
export type ChangeCombinationError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "VALIDATION_ERROR" | "DUPLICATE_COMBINATION" | "PRODUCT_WITHOUT_OPTIONS" | "ID_CONFLICT" | VariantNotFound }>;
export type ChangeVariantStatusError = ProductTransportFailure | Extract<ApiFailure, { code: "INVALID_INPUT" | "PRODUCT_WITHOUT_OPTIONS" | VariantNotFound }>;
export type DeleteVariantError = ProductTransportFailure | Extract<ApiFailure, { code: "VARIANT_HAS_ORDERS" | "VARIANT_HAS_STOCK" | "LAST_VARIANT" | VariantNotFound }>;
export type UploadProductImageError = UploadImageError;

type Request = (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;

function fieldFailure(code: MobileTransportCode, message: string): ProductTransportFailure {
  return { code, message };
}

/** The status core answers with each code (§8.2). A code outside this table is not a product code. */
export const expectedStatus: Readonly<Record<string, number>> = {
  INVALID_INPUT: 400, VALIDATION_ERROR: 422, DUPLICATE_SKU: 409, PRODUCT_ID_CONFLICT: 409, ID_CONFLICT: 409,
  PRODUCT_CHANGED: 409, DUPLICATE_COMBINATION: 409, VARIANT_HAS_ORDERS: 409, VARIANT_HAS_STOCK: 409, LAST_VARIANT: 409, PRODUCT_WITHOUT_OPTIONS: 409,
  PRODUCT_NOT_FOUND: 404, VARIANT_NOT_FOUND: 404, IMAGE_NOT_FOUND: 404, PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415, UNAUTHENTICATED: 401, COMPANY_REQUIRED: 409,
  SERVICE_UNAVAILABLE: 503, INTERNAL_ERROR: 500, INVALID_IMAGE: 400, IMAGE_TOO_LARGE: 413,
  IMAGE_STORAGE_UNAVAILABLE: 502,
};

function readApiFailure(error: TransportError, allowed: readonly string[]): ApiFailure | ProductTransportFailure {
  if (error.http?.status === 429) return fieldFailure("RATE_LIMITED", error.message);
  if (!error.http) {
    const transportCodes: readonly string[] = ["UNAUTHENTICATED", "COMPANY_REQUIRED", "NETWORK_ERROR", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "SERVER_ERROR", "INVALID_RESPONSE", "OPERATION_CANCELLED", "SECURE_STORAGE_ERROR", "API_ERROR"];
    return fieldFailure(transportCodes.includes(error.code) ? error.code as MobileTransportCode : "API_ERROR", error.message);
  }
  const parsed = productApiErrorSchema.safeParse(error.http.body);
  if (!parsed.success) return fieldFailure("INVALID_RESPONSE", "Server returned an invalid error");
  // Codes outside the shared enum (transport and image codes) keep their own handling; an unknown product code is generic.
  const known = productApiErrorCodeSchema.safeParse(parsed.data.code).success || expectedStatus[parsed.data.code] !== undefined;
  if (!known || !allowed.includes(parsed.data.code)) return fieldFailure("API_ERROR", "The request could not be completed");
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
    activeVariantCount: item.activeVariantCount,
    ...(item.sku === undefined ? {} : { sku: item.sku }),
    price: item.minSalePrice,
    priceFrom: item.hasDifferentPrices,
    stock: item.totalStock,
    ...(item.image === undefined ? {} : { photo: { id: item.image.id as ImageId, url: item.image.url } }),
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
    ...(dto.product.description === null ? {} : { description: dto.product.description }),
    currency: dto.product.currency,
    ...(dto.product.photos[0] === undefined ? {} : { photo: { id: dto.product.photos[0].id as ImageId, url: dto.product.photos[0].url } }),
    structureVersion: dto.product.structureVersion,
    options: dto.product.options.map((option) => ({ id: option.id as OptionId, name: option.name, values: option.values.map((value) => ({ id: value.id as OptionValueId, name: value.name })) })),
    variants: dto.product.variants.map((variant) => ({
      id: variant.id as VariantId,
      qrCode: variant.qrCode as VariantQrCode,
      combination: variant.combination.map((entry) => ({ optionId: entry.optionId as OptionId, valueId: entry.valueId as OptionValueId })),
      ...(variant.sku === null ? {} : { sku: variant.sku }),
      salePrice: variant.salePrice,
      ...(variant.purchasePrice === null ? {} : { purchasePrice: variant.purchasePrice }),
      stock: variant.stock,
      status: variant.status === "active" ? "active" as const : "inactive" as const,
      hasOrders: variant.hasOrders,
    })),
  };
}

export function createProductApi(request: Request, sessionGeneration: () => number) {
  const pendingProducts = new Map<string, Promise<Result<Product, GetProductError>>>();
  const run = async (path: string, init: RequestInit, allowed: readonly string[]) => {
    const result = await request(path, init);
    return result.success ? result : err(readApiFailure(result.error, allowed));
  };
  const readProduct = async (id: ProductId): Promise<Result<Product, GetProductError>> => {
    const result = restrictFailure(await run(`/api/products/${encodeURIComponent(id)}`, {}, ["PRODUCT_NOT_FOUND", "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), ["PRODUCT_NOT_FOUND"] as const);
    if (!result.success) return result;
    const parsed = productDetailResponseSchema.safeParse(result.data);
    return parsed.success ? ok(productDetail(parsed.data)) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product data"));
  };
  /** The per-variant actions answer the refreshed detail, so a screen needs no follow-up read. */
  const variantAction = async <E extends ApiFailure["code"]>(
    productId: ProductId, variantId: VariantId, suffix: string, init: RequestInit, codes: readonly E[],
  ): Promise<Result<Product, Extract<ApiFailure, { code: E }> | ProductTransportFailure>> => {
    const path = `/api/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}${suffix}`;
    const result = restrictFailure(await run(path, init, [...codes, "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), codes);
    if (!result.success) return result;
    const parsed = productDetailResponseSchema.safeParse(result.data);
    return parsed.success ? ok(productDetail(parsed.data)) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product data"));
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    async list(criteria: ProductListCriteria): Promise<Result<ProductPage, ListProductsError>> {
      const params = new URLSearchParams({ page: String(criteria.page), pageSize: String(criteria.pageSize) });
      const search = criteria.search?.trim();
      if (search) params.set("search", search);
      if (criteria.stock) params.set("stock", criteria.stock);
      if (criteria.sort) params.set("sort", criteria.sort);
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
    get(id: ProductId): Promise<Result<Product, GetProductError>> {
      const key = `${sessionGeneration()}:${id}`;
      const pending = pendingProducts.get(key);
      if (pending) return pending;
      const read = readProduct(id).finally(() => pendingProducts.delete(key));
      pendingProducts.set(key, read);
      return read;
    },
    async create(input: CreateProductRequest): Promise<Result<ProductId, CreateProductError>> {
      const body = createProductRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "INVALID_INPUT", message: "Invalid product input" });
      const result = restrictFailure(await run("/api/products", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body.data),
      }, ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "PRODUCT_ID_CONFLICT", "ID_CONFLICT", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "PRODUCT_ID_CONFLICT", "ID_CONFLICT", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"] as const);
      if (!result.success) return result;
      const parsed = productIdResponseSchema.safeParse(result.data);
      return parsed.success ? ok(parsed.data.id as ProductId) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product ID"));
    },
    async uploadImage(uri: string): Promise<Result<Readonly<{ id: ImageId; url: string }>, UploadProductImageError>> {
      const result = await uploadImage(request, uri, "image/jpeg");
      return result.success ? ok({ id: result.data.id as ImageId, url: result.data.url }) : result;
    },
    /** The editor's «Guardar cambios»: answers the full detail, so the screen needs no follow-up read. */
    async save(id: ProductId, input: SaveProductRequest): Promise<Result<Product, SaveProductError>> {
      const body = saveProductRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "INVALID_INPUT", message: "Invalid product input" });
      const codes = ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "PRODUCT_CHANGED", "ID_CONFLICT", "VARIANT_HAS_ORDERS", "PRODUCT_NOT_FOUND", "IMAGE_NOT_FOUND", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"] as const;
      const result = restrictFailure(await run(`/api/products/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body.data),
      }, [...codes, "UNAUTHENTICATED", "COMPANY_REQUIRED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"]), codes);
      if (!result.success) return result;
      const parsed = productDetailResponseSchema.safeParse(result.data);
      return parsed.success ? ok(productDetail(parsed.data)) : err(fieldFailure("INVALID_RESPONSE", "Server returned invalid product data"));
    },
    async updateVariant(productId: ProductId, variantId: VariantId, input: UpdateVariantRequest): Promise<Result<Product, UpdateVariantError>> {
      const body = updateVariantRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "INVALID_INPUT", message: "Invalid variant input" });
      return variantAction(productId, variantId, "", json("PATCH", body.data), ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_SKU", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND"] as const);
    },
    async changeCombination(productId: ProductId, variantId: VariantId, input: ChangeCombinationRequest): Promise<Result<Product, ChangeCombinationError>> {
      const body = changeCombinationRequestSchema.safeParse(input);
      if (!body.success) return err({ code: "INVALID_INPUT", message: "Invalid combination input" });
      return variantAction(productId, variantId, "/combination", json("PUT", body.data),
        ["INVALID_INPUT", "VALIDATION_ERROR", "DUPLICATE_COMBINATION", "PRODUCT_WITHOUT_OPTIONS", "ID_CONFLICT", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND"] as const);
    },
    changeStatus(productId: ProductId, variantId: VariantId, status: "active" | "inactive"): Promise<Result<Product, ChangeVariantStatusError>> {
      return variantAction(productId, variantId, "/status", json("PUT", changeVariantStatusRequestSchema.parse({ status })),
        ["INVALID_INPUT", "PRODUCT_WITHOUT_OPTIONS", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND"] as const);
    },
    deleteVariant(productId: ProductId, variantId: VariantId): Promise<Result<Product, DeleteVariantError>> {
      return variantAction(productId, variantId, "", { method: "DELETE" }, ["VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK", "LAST_VARIANT", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND"] as const);
    },
  };
}
