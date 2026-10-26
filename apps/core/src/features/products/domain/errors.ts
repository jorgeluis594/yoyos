export type ProductField = "name" | "description" | "imageId" | "currency" | "options" | "variants";
export type OptionField = "id" | "name" | "values" | "valueForExistingVariants";
export type ValueField = "id" | "name";
export type VariantField = "id" | "values" | "sku" | "salePrice" | "purchasePrice" | "initialStock";
export type ProductValidationReason =
  | { readonly reason: "REQUIRED" }
  | { readonly reason: "INVALID_TYPE" }
  | { readonly reason: "TOO_LONG"; readonly maxLength: number }
  | { readonly reason: "INVALID_CURRENCY" }
  | { readonly reason: "INVALID_PRICE"; readonly minimum: number; readonly maximum: number }
  | { readonly reason: "INVALID_PRECISION"; readonly maxDecimals: number }
  | { readonly reason: "INVALID_STOCK" }
  | { readonly reason: "INVALID_TOTAL_STOCK" }
  | { readonly reason: "DUPLICATE_SKU" }
  | { readonly reason: "DUPLICATE_VARIANT" }
  | { readonly reason: "VARIANT_NOT_FOUND" }
  | { readonly reason: "TOO_MANY_OPTIONS"; readonly maximum: number }
  | { readonly reason: "TOO_MANY_VALUES"; readonly maximum: number }
  | { readonly reason: "TOO_MANY_VARIANTS"; readonly maximum: number }
  | { readonly reason: "DUPLICATE_OPTION" }
  | { readonly reason: "DUPLICATE_VALUE" }
  | { readonly reason: "OPTION_WITHOUT_VALUES" }
  | { readonly reason: "INVALID_COMBINATION" }
  | { readonly reason: "DUPLICATE_COMBINATION" }
  | { readonly reason: "VALUE_NOT_FOUND" }
  | { readonly reason: "VALUE_IN_USE" }
  | { readonly reason: "MISSING_VALUE_FOR_EXISTING_VARIANTS" }
  | { readonly reason: "VARIANT_HAS_ORDERS" }
  | { readonly reason: "VARIANT_HAS_STOCK" }
  | { readonly reason: "LAST_VARIANT" }
  | { readonly reason: "ID_CONFLICT" }
  | { readonly reason: "OPTION_HAS_SEVERAL_VALUES" }
  | { readonly reason: "LAST_OPTION_VARIANT_INACTIVE" };
export type ValidationIssue = (
  | { readonly scope: "product"; readonly field: ProductField; readonly message: string }
  | { readonly scope: "option"; readonly optionIndex: number; readonly optionId?: string; readonly field: OptionField; readonly message: string }
  | { readonly scope: "value"; readonly optionIndex: number; readonly valueIndex: number; readonly valueId?: string; readonly field: ValueField; readonly message: string }
  | { readonly scope: "variant"; readonly variantId: string; readonly field: VariantField; readonly message: string }
  | { readonly scope: "newVariant"; readonly index: number; readonly field: VariantField; readonly message: string }
) & ProductValidationReason;
export type ValidationError = Readonly<{
  code: "VALIDATION_ERROR";
  issues: readonly [ValidationIssue, ...ValidationIssue[]];
  message: string;
}>;

/** Business rejections of the product writes, before the persistence failures that the application ports add. */
export type ProductBusinessError =
  | ValidationError
  | Readonly<{ code: "PRODUCT_NOT_FOUND"; message: string }>
  | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string }>
  | Readonly<{ code: "IMAGE_NOT_FOUND"; message: string }>
  | Readonly<{ code: "PRODUCT_CHANGED"; message: string }>
  | Readonly<{ code: "PRODUCT_ID_CONFLICT"; message: string }>
  | Readonly<{ code: "DUPLICATE_SKU"; message: string }>
  | Readonly<{ code: "DUPLICATE_COMBINATION"; message: string }>
  | Readonly<{ code: "ID_CONFLICT"; message: string }>
  | Readonly<{ code: "VARIANT_HAS_ORDERS"; message: string }>
  | Readonly<{ code: "VARIANT_HAS_STOCK"; message: string }>
  | Readonly<{ code: "LAST_VARIANT"; message: string }>
  | Readonly<{ code: "PRODUCT_WITHOUT_OPTIONS"; message: string }>;
