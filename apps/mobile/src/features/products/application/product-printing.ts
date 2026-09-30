import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { prepareProductLabel, type ProductLabel, type ProductLabelError } from "@mobile/features/products/domain/product-label";
import type { Product, ProductId, VariantId } from "@mobile/features/products/domain/product";
import type { CopyCount, PrintReceipt, RenderProfile, RenderedDocument } from "@mobile/features/printing/domain/printing";
import { productLabelFormat } from "@mobile/features/printing/domain/printing";
import type { PrintExecution, PrintFailure, PrintOutcome, RenderError } from "@mobile/features/printing/application/contracts";

export type GetProductError = Readonly<{ code: "UNAUTHENTICATED" | "COMPANY_REQUIRED" | "NETWORK_ERROR" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_RESPONSE" | "OPERATION_CANCELLED" | "SECURE_STORAGE_ERROR" | "API_ERROR" | "PRODUCT_NOT_FOUND"; message: string }>;
export type ProductLabelSource = Readonly<{ kind: "saved-product"; product: Product; variantId: VariantId }> | Readonly<{ kind: "created-product"; productId: ProductId }>;
export type ProductLabelRetry = Readonly<{ kind: "load-created-product"; productId: ProductId; copies: CopyCount }> | Readonly<{ kind: "prepare-saved-product"; product: Product; variantId: VariantId; copies: CopyCount }> | Readonly<{ kind: "prepared-label"; label: ProductLabel; copies: CopyCount }>;
export type ProductPrintSuccess = Readonly<{ status: "completed"; receipt: PrintReceipt }> | Readonly<{ status: "selection-required"; retry: ProductLabelRetry }>;
export type ProductPrintFailure = Readonly<{ code: "PRODUCT_PRINT_FAILED"; message: string; cause: GetProductError | ProductLabelError | PrintFailure; retry: ProductLabelRetry }>;
export type ProductPrintResult = Result<ProductPrintSuccess, ProductPrintFailure>;
export type RenderProductLabel = (label: ProductLabel, profile: RenderProfile) => Promise<Result<RenderedDocument, RenderError>>;
export type ProductPrintingDependencies = Readonly<{
  loadProduct: (id: ProductId) => Promise<Result<Product, GetProductError>>;
  renderProductLabel: RenderProductLabel;
  printDocument: (request: Readonly<{ format: typeof productLabelFormat; copies: CopyCount; render: (profile: RenderProfile) => Promise<Result<RenderedDocument, RenderError>> }>, execution: PrintExecution) => Promise<Result<PrintOutcome, PrintFailure>>;
}>;

export function createProductPrintingOperations({ loadProduct, renderProductLabel, printDocument }: ProductPrintingDependencies) {
  const printPrepared = async (retry: Extract<ProductLabelRetry, { kind: "prepared-label" }>, execution: PrintExecution): Promise<ProductPrintResult> => {
    const result = await printDocument({ format: productLabelFormat, copies: retry.copies, render: (profile) => renderProductLabel(retry.label, profile) }, execution);
    if (!result.success) return err({ code: "PRODUCT_PRINT_FAILED", message: result.error.message, cause: result.error, retry });
    return result.data.status === "completed" ? ok({ status: "completed", receipt: result.data.receipt }) : ok({ status: "selection-required", retry });
  };

  const printProductLabel = async (source: ProductLabelSource, copies: CopyCount, execution: PrintExecution): Promise<ProductPrintResult> => {
    if (source.kind === "saved-product") {
      const label = prepareProductLabel(source.product, source.variantId);
      if (!label.success) return err({ code: "PRODUCT_PRINT_FAILED", message: label.error.message, cause: label.error, retry: { kind: "prepare-saved-product", product: source.product, variantId: source.variantId, copies } });
      return printPrepared({ kind: "prepared-label", label: label.data, copies }, execution);
    }
    const fallback: ProductLabelRetry = { kind: "load-created-product", productId: source.productId, copies };
    const loaded = await loadProduct(source.productId);
    if (!loaded.success) return err({ code: "PRODUCT_PRINT_FAILED", message: loaded.error.message, cause: loaded.error, retry: fallback });
    if (loaded.data.variants.length !== 1) {
      const cause: ProductLabelError = loaded.data.variants.length
        ? { code: "VARIANT_SELECTION_REQUIRED", message: "Choose a variant to print" }
        : { code: "VARIANT_NOT_FOUND", message: "Product has no variants" };
      return err({ code: "PRODUCT_PRINT_FAILED", message: cause.message, cause, retry: fallback });
    }
    const label = prepareProductLabel(loaded.data, loaded.data.variants[0].id);
    if (!label.success) return err({ code: "PRODUCT_PRINT_FAILED", message: label.error.message, cause: label.error, retry: fallback });
    return printPrepared({ kind: "prepared-label", label: label.data, copies }, execution);
  };

  const retryProductLabel = (retry: ProductLabelRetry, execution: PrintExecution): Promise<ProductPrintResult> => retry.kind === "prepared-label"
    ? printPrepared(retry, execution)
    : retry.kind === "prepare-saved-product"
      ? printProductLabel({ kind: "saved-product", product: retry.product, variantId: retry.variantId }, retry.copies, execution)
      : printProductLabel({ kind: "created-product", productId: retry.productId }, retry.copies, execution);

  return { printProductLabel, retryProductLabel };
}
