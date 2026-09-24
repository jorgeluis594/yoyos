export type ProductField = "name" | "description" | "imageId" | "currency" | "variants";
export type VariantField = "attributes" | "sku" | "salePrice" | "purchasePrice" | "initialStock";
export type ProductValidationReason =
  | { readonly reason: "REQUIRED" }
  | { readonly reason: "INVALID_TYPE" }
  | { readonly reason: "TOO_LONG"; readonly maxLength: number }
  | { readonly reason: "INVALID_CURRENCY" }
  | { readonly reason: "INVALID_PRICE"; readonly minimum: number; readonly maximum: number }
  | { readonly reason: "INVALID_PRECISION"; readonly maxDecimals: number }
  | { readonly reason: "INVALID_STOCK" }
  | { readonly reason: "INVALID_ATTRIBUTES" }
  | { readonly reason: "DUPLICATE_ATTRIBUTES" }
  | { readonly reason: "DUPLICATE_SKU" };
export type ValidationIssue = (
  | { readonly scope: "product"; readonly field: ProductField; readonly message: string }
  | { readonly scope: "variant"; readonly index: number; readonly field: VariantField; readonly message: string }
) & ProductValidationReason;
export type ValidationError = Readonly<{
  code: "VALIDATION_ERROR";
  issues: readonly [ValidationIssue, ...ValidationIssue[]];
  message: string;
}>;
