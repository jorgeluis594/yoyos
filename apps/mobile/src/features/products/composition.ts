import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductPrintingOperations } from "@mobile/features/products/application/product-printing";
import { renderProductLabel } from "@mobile/features/products/infrastructure/product-label-renderer";
import { printing } from "@mobile/features/printing/composition";
import { request, sessionGeneration } from "@mobile/composition/auth";

export const products = createProductOperations(createProductApi(request, sessionGeneration));
export const productPrinting = createProductPrintingOperations({
  loadProduct: products.loadProduct,
  renderProductLabel,
  printDocument: async (request, execution) => {
    const reserved = await printing.withPrinter((session) => session.printDocument(request, execution));
    return reserved.success ? reserved.data : reserved;
  },
});
