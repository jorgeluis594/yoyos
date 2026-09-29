import { productPrinting } from "@mobile/features/products/composition";
import type { ProductLabelRetry, ProductLabelSource } from "@mobile/features/products/application/product-printing";
import type { CopyCount } from "@mobile/features/printing/domain/printing";
import type { PrintWork } from "@mobile/features/printing/presentation/print-provider";

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
      const message = cause.code === "VARIANT_SELECTION_REQUIRED" ? "Elige una variante desde el detalle para imprimir."
        : cause.code === "VARIANT_NOT_FOUND" ? "Este producto no tiene variantes para imprimir."
          : cause.code === "PRODUCT_NOT_FOUND" ? "No se encontró el producto guardado."
            : cause.code === "UNAUTHENTICATED" ? "Inicia sesión para consultar el producto e imprimir."
              : cause.code === "COMPANY_REQUIRED" ? "Selecciona una empresa para consultar el producto e imprimir."
                : cause.code === "LABEL_CONTENT_OVERFLOW" ? "El contenido no cabe completo en esta etiqueta."
                  : cause.code === "PAPER_EMPTY" ? "La impresora no tiene etiquetas."
                    : cause.code === "PAPER_MISMATCH" ? "Coloca etiquetas Brother DK-1209 de 62 × 29 mm."
                      : cause.code === "COVER_OPEN" ? "Cierra la tapa de la impresora."
                        : cause.code === "PRINTING_UNAVAILABLE" ? "La impresión está disponible en Android con una app compatible."
                          : "outcome" in cause ? "No se pudo imprimir. Revisa la impresora y la conexión."
                            : "No se pudo consultar el producto para imprimir.";
      return { status: "failed", message, outcome };
    }
    if (result.data.status === "selection-required") {
      retry = result.data.retry;
      return { status: "selection-required" };
    }
    return { status: "completed" };
  };
}
