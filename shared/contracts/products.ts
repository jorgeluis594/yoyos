import { z } from "zod";
import { currencies } from "@shared/money";

const productIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const uuidSchema = z.uuid();
const moneySchema = z.object({ amount: z.number(), currency: z.enum(currencies) }).readonly();

export const productOptionLimits = { options: 3, valuesPerOption: 30, variants: 100, nameLength: 30 } as const;
export const productPhotoLimits = { maxPhotos: 8 } as const;
export const normalizeOptionText = (value: string) => value.trim().toLowerCase();

// Requests are strict: an unknown field is a client bug.
const optionRequestSchema = z.strictObject({
  id: uuidSchema,
  name: z.string(),
  values: z.array(z.strictObject({ id: uuidSchema, name: z.string() })),
  valueForExistingVariants: uuidSchema.optional(),
});
const newVariantSchema = z.strictObject({
  values: z.array(uuidSchema),
  sku: z.string().nullable(),
  salePrice: z.number(),
  purchasePrice: z.number().nullable(),
  initialStock: z.number(),
});

export const createProductRequestSchema = z.strictObject({
  id: productIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  // Ordered, position 0 is the primary. The limit and repeats are checked by core's domain so the client gets typed issues with the index.
  photoIds: z.array(uuidSchema),
  currency: z.enum(currencies),
  options: z.array(optionRequestSchema),
  variants: z.array(newVariantSchema).min(1),
}).readonly();

export const saveProductRequestSchema = z.strictObject({
  structureVersion: z.number().int().nonnegative(),
  name: z.string(),
  description: z.string().nullable(),
  // Omitted = photos untouched; present = the whole new ordered list.
  photoIds: z.array(uuidSchema).optional(),
  options: z.array(optionRequestSchema),
  variants: z.array(z.strictObject({ id: uuidSchema, sku: z.string().nullable(), salePrice: z.number(), purchasePrice: z.number().nullable() })),
  newVariants: z.array(newVariantSchema),
  deletedVariantIds: z.array(uuidSchema),
}).readonly();

export const updateVariantRequestSchema = z.strictObject({
  sku: z.string().nullable().optional(),
  salePrice: z.number().optional(),
  purchasePrice: z.number().nullable().optional(),
}).readonly();

export const changeCombinationRequestSchema = z.strictObject({
  values: z.array(z.union([
    z.strictObject({ optionId: uuidSchema, valueId: uuidSchema }),
    z.strictObject({ optionId: uuidSchema, newValue: z.strictObject({ id: uuidSchema, name: z.string() }) }),
  ])),
}).readonly();

export const changeVariantStatusRequestSchema = z.strictObject({ status: z.enum(["active", "inactive"]) }).readonly();

export const productListQuerySchema = z.object({
  search: z.string().optional(),
  stock: z.enum(["in_stock", "sold_out"]).optional(),
  sort: z.enum(["recent", "name"]).optional(),
  page: z.string().regex(/^-?\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^-?\d+$/).transform(Number).optional(),
}).strict();

const productImageSchema = z.object({ id: uuidSchema, url: z.url().refine((value) => /^https?:\/\//i.test(value)) });

export const productListResponseSchema = z.object({
  items: z.array(z.object({
    id: uuidSchema,
    name: z.string(),
    variantCount: z.number().int().positive(),
    activeVariantCount: z.number().int().nonnegative(),
    sku: z.string().optional(),
    minSalePrice: moneySchema.nullable(),
    hasDifferentPrices: z.boolean(),
    totalStock: z.number().int().nonnegative(),
    image: productImageSchema.optional(),
  })),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

// Responses are tolerant: their own non-strict objects, so a later optional field does not break a shipped build.
const optionValueResponseSchema = z.object({ id: uuidSchema, name: z.string() });
const optionResponseSchema = z.object({ id: uuidSchema, name: z.string(), values: z.array(optionValueResponseSchema) });
const variantResponseSchema = z.object({
  id: uuidSchema,
  combination: z.array(z.object({ optionId: uuidSchema, valueId: uuidSchema })),
  sku: z.string().nullable(),
  salePrice: moneySchema,
  purchasePrice: moneySchema.nullable(),
  qrCode: uuidSchema,
  // Clients treat every value other than "active" as not on sale.
  status: z.string(),
  stock: z.number().int().nonnegative(),
  hasOrders: z.boolean(),
});

export const productDetailResponseSchema = z.object({
  product: z.object({
    id: uuidSchema,
    name: z.string(),
    description: z.string().nullable(),
    photos: z.array(productImageSchema).max(productPhotoLimits.maxPhotos),
    currency: z.enum(currencies),
    qrCode: uuidSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    structureVersion: z.number().int().nonnegative(),
    options: z.array(optionResponseSchema),
    variants: z.array(variantResponseSchema).min(1),
  }),
}).superRefine((response, context) => {
  const { product } = response;
  const photoIds = new Set<string>();
  product.photos.forEach((photo, photoIndex) => {
    if (photoIds.has(photo.id)) context.addIssue({ code: "custom", path: ["product", "photos", photoIndex, "id"], message: "Photo must be unique" });
    photoIds.add(photo.id);
  });
  const optionIds = new Set<string>();
  const valueIds = new Set<string>();
  const valueOwner = new Map<string, string>();
  product.options.forEach((option, optionIndex) => {
    if (optionIds.has(option.id)) context.addIssue({ code: "custom", path: ["product", "options", optionIndex, "id"], message: "Option must be unique" });
    optionIds.add(option.id);
    option.values.forEach((value, valueIndex) => {
      if (valueIds.has(value.id)) context.addIssue({ code: "custom", path: ["product", "options", optionIndex, "values", valueIndex, "id"], message: "Value must be unique" });
      valueIds.add(value.id);
      valueOwner.set(value.id, option.id);
    });
  });
  product.variants.forEach((variant, index) => {
    const path = ["product", "variants", index];
    if (variant.salePrice.currency !== product.currency || variant.purchasePrice !== null && variant.purchasePrice.currency !== product.currency) {
      context.addIssue({ code: "custom", path, message: "Variant currency must match product currency" });
    }
    const matches = variant.combination.length === product.options.length
      && product.options.every((option, position) => variant.combination[position]?.optionId === option.id && valueOwner.get(variant.combination[position].valueId) === option.id);
    if (!matches) context.addIssue({ code: "custom", path: [...path, "combination"], message: "Combination must hold one value per option, in option order" });
  });
});

export const productIdResponseSchema = z.object({ id: uuidSchema });
export const productApiErrorCodeSchema = z.enum([
  "INVALID_INPUT", "VALIDATION_ERROR", "PRODUCT_NOT_FOUND", "VARIANT_NOT_FOUND", "IMAGE_NOT_FOUND",
  "PRODUCT_ID_CONFLICT", "PRODUCT_CHANGED", "ID_CONFLICT", "DUPLICATE_SKU", "DUPLICATE_COMBINATION", "VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK",
  "LAST_VARIANT", "PRODUCT_WITHOUT_OPTIONS", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "UNSUPPORTED_MEDIA_TYPE",
]);
export const productIssueReasonSchema = z.enum([
  "REQUIRED", "INVALID_TYPE", "TOO_LONG", "INVALID_CURRENCY", "INVALID_PRICE", "INVALID_PRECISION", "INVALID_STOCK", "INVALID_TOTAL_STOCK",
  "DUPLICATE_SKU", "DUPLICATE_VARIANT", "VARIANT_NOT_FOUND",
  "TOO_MANY_OPTIONS", "TOO_MANY_VALUES", "TOO_MANY_VARIANTS", "DUPLICATE_OPTION", "DUPLICATE_VALUE", "OPTION_WITHOUT_VALUES",
  "INVALID_COMBINATION", "DUPLICATE_COMBINATION", "VALUE_NOT_FOUND", "VALUE_IN_USE", "MISSING_VALUE_FOR_EXISTING_VARIANTS",
  "VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK", "LAST_VARIANT", "ID_CONFLICT", "OPTION_HAS_SEVERAL_VALUES", "LAST_OPTION_VARIANT_INACTIVE",
  "TOO_MANY_PHOTOS", "DUPLICATE_PHOTO", "PHOTO_NOT_FOUND",
  "UNKNOWN_FIELD", "INVALID_FORMAT", "DUPLICATE_FIELD", "INVALID_RANGE", "UNSAFE_PAGINATION",
]);
export const productApiIssueSchema = z.object({
  scope: z.enum(["product", "option", "value", "variant", "newVariant", "photo", "criteria", "input"]).optional(),
  field: z.string(),
  index: z.number().int().nonnegative().optional(),
  optionIndex: z.number().int().nonnegative().optional(),
  optionId: z.string().optional(),
  valueIndex: z.number().int().nonnegative().optional(),
  valueId: z.string().optional(),
  variantId: z.string().optional(),
  message: z.string().optional(),
  reason: z.string(),
  maximum: z.number().optional(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maxDecimals: z.number().optional(),
}).loose();
// Clients narrow `code` with productApiErrorCodeSchema.safeParse; an unknown code maps to a generic error.
export const productApiErrorSchema = z.object({
  code: z.string().min(1),
  error: z.string(),
  issues: z.array(productApiIssueSchema).optional(),
}).loose();

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export type SaveProductRequest = z.infer<typeof saveProductRequestSchema>;
export type UpdateVariantRequest = z.infer<typeof updateVariantRequestSchema>;
export type ChangeCombinationRequest = z.infer<typeof changeCombinationRequestSchema>;
export type ChangeVariantStatusRequest = z.infer<typeof changeVariantStatusRequestSchema>;
export type ProductApiErrorCode = z.infer<typeof productApiErrorCodeSchema>;
export type ProductIssueReason = z.infer<typeof productIssueReasonSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;
export type ProductIdResponse = z.infer<typeof productIdResponseSchema>;
export type ProductApiError = z.infer<typeof productApiErrorSchema>;
