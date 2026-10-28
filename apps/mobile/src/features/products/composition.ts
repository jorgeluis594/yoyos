import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { createVariantOperations } from "@mobile/features/products/application/variant-operations";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductPrintingOperations } from "@mobile/features/products/application/product-printing";
import { renderProductLabel } from "@mobile/features/products/infrastructure/product-label-renderer";
import { printing } from "@mobile/features/printing/composition";
import { request, sessionGeneration } from "@mobile/composition/auth";

const api = createProductApi(request, sessionGeneration);
export const products = createProductOperations(api);
export const variants = createVariantOperations(api);
export const productPrinting = createProductPrintingOperations({
  loadProduct: products.loadProduct,
  renderProductLabel,
  printDocument: async (request, execution) => {
    const reserved = await printing.withPrinter((session) => session.printDocument(request, execution));
    return reserved.success ? reserved.data : reserved;
  },
});
