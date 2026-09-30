import { err, ok } from "@shared/functional";
import { createProductPrintingOperations } from "@mobile/features/products/application/product-printing";
import type { GetProductError, ProductPrintingDependencies } from "@mobile/features/products/application/product-printing";
import type { Result } from "@shared/result";
import type { Product, ProductId, VariantId, VariantQrCode } from "@mobile/features/products/domain/product";
import type { CopyCount } from "@mobile/features/printing/domain/printing";

const productId = "product" as ProductId;
const product: Product = { id: productId, name: "Camisa", currency: "PEN", variants: [
  { id: "small" as VariantId, qrCode: "small-qr" as VariantQrCode, sku: "CAM-S", attributes: {}, salePrice: { amount: 20, currency: "PEN" }, stock: 1 },
] };
const execution = { isSessionCurrent: () => true, onStage: () => {} };
const copies = 2 as CopyCount;

function setup(saved: Product = product) {
  const loadProduct = jest.fn(async (): Promise<Result<Product, GetProductError>> => ok(saved));
  const renderProductLabel = jest.fn(async () => ok({ uri: "file:///label.png", widthPx: 696, heightPx: 271 }));
  const printDocument = jest.fn(async (request: Parameters<ProductPrintingDependencies["printDocument"]>[0]): ReturnType<ProductPrintingDependencies["printDocument"]> => {
    await request.render({ widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 });
    return ok({ status: "completed", printer: { id: "printer" as never, adapterId: "brother" as never, displayName: "Brother", model: "QL-810W" }, receipt: { confirmation: "sdk" } });
  });
  return { operations: createProductPrintingOperations({ loadProduct, renderProductLabel, printDocument }), loadProduct, renderProductLabel, printDocument };
}

test("loads a newly created product and prints its persisted variant QR", async () => {
  const { operations, loadProduct, renderProductLabel } = setup();
  expect(await operations.printProductLabel({ kind: "created-product", productId }, copies, execution)).toMatchObject({ success: true, data: { status: "completed" } });
  expect(loadProduct).toHaveBeenCalledWith(productId);
  expect(renderProductLabel).toHaveBeenCalledWith({ productName: "Camisa", sku: "CAM-S", qrCode: "small-qr" }, expect.anything());
});

test("a failed post-create load retries the same ID without creating another product", async () => {
  const { operations, loadProduct } = setup();
  loadProduct.mockImplementationOnce(async () => err({ code: "NETWORK_ERROR" as const, message: "Offline" }));
  const failed = await operations.printProductLabel({ kind: "created-product", productId }, copies, execution);
  expect(failed).toMatchObject({ success: false, error: { cause: { code: "NETWORK_ERROR" }, retry: { kind: "load-created-product", productId, copies: 2 } } });
  if (failed.success) throw new Error("Expected a failed load");
  expect(await operations.retryProductLabel(failed.error.retry, execution)).toMatchObject({ success: true, data: { status: "completed" } });
  expect(loadProduct).toHaveBeenCalledTimes(2);
});

test("a prepared retry keeps saved content when the product changes", async () => {
  const { operations, renderProductLabel, loadProduct, printDocument } = setup();
  jest.mocked(printDocument).mockImplementationOnce(async () => ok({ status: "selection-required" }));
  const first = await operations.printProductLabel({ kind: "saved-product", product, variantId: product.variants[0].id }, copies, execution);
  expect(first).toMatchObject({ success: true, data: { status: "selection-required" } });
  if (!first.success || first.data.status !== "selection-required") throw new Error("Expected printer selection");
  await operations.retryProductLabel(first.data.retry, execution);
  expect(loadProduct).not.toHaveBeenCalled();
  expect(renderProductLabel).toHaveBeenCalledWith({ productName: "Camisa", sku: "CAM-S", qrCode: "small-qr" }, expect.anything());
});

test("does not implicitly choose a variant on a multivariant created product", async () => {
  const { operations, printDocument } = setup({ ...product, variants: [...product.variants, { ...product.variants[0], id: "large" as VariantId, qrCode: "large-qr" as VariantQrCode }] });
  expect(await operations.printProductLabel({ kind: "created-product", productId }, copies, execution)).toMatchObject({ success: false, error: { cause: { code: "VARIANT_SELECTION_REQUIRED" } } });
  expect(printDocument).not.toHaveBeenCalled();
});
