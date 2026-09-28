import { z } from "zod";
import { currencies } from "@shared/money";

const productIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const uuidSchema = z.uuid();
const moneySchema = z.object({ amount: z.number(), currency: z.enum(currencies) }).readonly();
const attributesSchema = z.record(z.string(), z.string()).readonly();

export const createProductRequestSchema = z.object({
  id: productIdSchema,
  name: z.string(),
  description: z.string().optional(),
  imageId: uuidSchema.optional(),
  currency: z.enum(currencies),
  variants: z.array(z.object({
    attributes: attributesSchema,
    sku: z.string().optional(),
    salePrice: z.number(),
    purchasePrice: z.number().optional(),
    initialStock: z.number().optional(),
  }).strict()).min(1),
}).strict().readonly();

export const updateProductRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  imageId: uuidSchema.nullable().optional(),
  variants: z.array(z.object({
    id: uuidSchema,
    sku: z.string().nullable().optional(),
    salePrice: z.number().optional(),
    purchasePrice: z.number().nullable().optional(),
  }).strict()).optional(),
}).strict().readonly();

export const productListQuerySchema = z.object({
  search: z.string().optional(),
  page: z.string().regex(/^-?\d+$/).transform(Number).optional(),
  pageSize: z.string().regex(/^-?\d+$/).transform(Number).optional(),
}).strict();

export const productListResponseSchema = z.object({
  items: z.array(z.object({
    id: uuidSchema,
    name: z.string(),
    variantCount: z.number().int().positive(),
    sku: z.string().optional(),
    minSalePrice: moneySchema,
    hasDifferentPrices: z.boolean(),
    totalStock: z.number().int().nonnegative(),
  })),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export const productDetailResponseSchema = z.object({
  product: z.object({
    id: uuidSchema,
    name: z.string(),
    description: z.string().optional(),
    imageId: uuidSchema.optional(),
    currency: z.enum(currencies),
    qrCode: uuidSchema,
    status: z.literal("active"),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    variants: z.array(z.object({
      id: uuidSchema,
      productId: uuidSchema,
      attributes: attributesSchema,
      sku: z.string().optional(),
      salePrice: moneySchema,
      purchasePrice: moneySchema.optional(),
      qrCode: uuidSchema,
      status: z.literal("active"),
      stock: z.object({ variantId: uuidSchema, quantity: z.number().int().nonnegative() }),
    })).min(1),
  }),
  image: z.object({ id: uuidSchema, url: z.url().refine((value) => /^https?:\/\//i.test(value)) }).optional(),
}).superRefine((response, context) => {
  if ((response.product.imageId === undefined) !== (response.image === undefined) || response.image && response.product.imageId !== response.image.id) {
    context.addIssue({ code: "custom", path: ["image", "id"], message: "Image must match the product reference" });
  }
  response.product.variants.forEach((variant, index) => {
    if (variant.productId !== response.product.id) context.addIssue({ code: "custom", path: ["product", "variants", index, "productId"], message: "Variant must belong to the product" });
    if (variant.stock.variantId !== variant.id) context.addIssue({ code: "custom", path: ["product", "variants", index, "stock", "variantId"], message: "Stock must belong to the variant" });
    if (variant.salePrice.currency !== response.product.currency || variant.purchasePrice?.currency !== undefined && variant.purchasePrice.currency !== response.product.currency) {
      context.addIssue({ code: "custom", path: ["product", "variants", index], message: "Variant currency must match product currency" });
    }
  });
});

export const productIdResponseSchema = z.object({ id: uuidSchema });
export const productApiIssueSchema = z.object({
  scope: z.enum(["product", "variant", "criteria", "input"]).optional(),
  field: z.string(),
  index: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
  reason: z.string(),
  maxLength: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  maxDecimals: z.number().optional(),
}).loose();
export const productApiErrorSchema = z.object({
  code: z.string().min(1),
  error: z.string(),
  issues: z.array(productApiIssueSchema).optional(),
}).loose();

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
export type ProductDetailResponse = z.infer<typeof productDetailResponseSchema>;
export type ProductIdResponse = z.infer<typeof productIdResponseSchema>;
export type ProductApiError = z.infer<typeof productApiErrorSchema>;
