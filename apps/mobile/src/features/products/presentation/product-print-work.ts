import { productPrinting } from "@mobile/features/products/composition";
import type { ProductLabelRetry, ProductLabelSource } from "@mobile/features/products/application/product-printing";
import type { CopyCount } from "@mobile/features/printing/domain/printing";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";
import i18n from '@mobile/i18n';

export function productPrintWork(source: ProductLabelSource, copies: CopyCount): PrintWork {
  let retry: ProductLabelRetry | null = null;
  return async (execution) => {
    const result = retry
      ? await productPrinting.retryProductLabel(retry, execution)
      : await productPrinting.printProductLabel(source, copies, execution);
    if (!result.success) {
      retry = result.error.retry;
      const cause = result.error.cause;
      const outcome = "outcome" in cause ? cause.outcome : "not-sent";
      const message = cause.code === "VARIANT_SELECTION_REQUIRED" ? i18n.t('chooseVariantToPrint')
        : cause.code === "VARIANT_NOT_FOUND" ? i18n.t('noVariantsToPrint')
          : cause.code === "PRODUCT_NOT_FOUND" ? i18n.t('savedProductNotFound')
            : cause.code === "UNAUTHENTICATED" ? i18n.t('signInToPrint')
              : cause.code === "COMPANY_REQUIRED" ? i18n.t('companyToPrint')
                : cause.code === "LABEL_CONTENT_OVERFLOW" ? i18n.t('labelOverflow')
                  : cause.code === "RENDER_FAILED" || cause.code === "UNSUPPORTED_FORMAT" ? i18n.t('labelPrepareError')
                    : cause.code === "PAPER_EMPTY" ? i18n.t('paperEmpty')
                      : cause.code === "PAPER_MISMATCH" ? i18n.t('paperMismatch')
                        : cause.code === "COVER_OPEN" ? i18n.t('coverOpen')
                          : cause.code === "PRINTING_UNAVAILABLE" ? i18n.t('printingAndroidOnly')
                            : "outcome" in cause ? i18n.t('printCheckPrinter')
                              : i18n.t('productPrintLookupError');
      return { status: "failed", message, outcome };
    }
    if (result.data.status === "selection-required") {
      retry = result.data.retry;
      return { status: "selection-required" };
    }
    return { status: "completed" };
  };
}
