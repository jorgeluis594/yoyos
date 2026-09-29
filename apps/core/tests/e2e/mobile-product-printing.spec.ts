import type { APIRequestContext } from "@playwright/test";
import { vi } from "vitest";
import { err, ok } from "@shared/functional";
import { productDetailResponseSchema } from "@shared/contracts/products";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductPrintingOperations, type ProductPrintingDependencies } from "@mobile/features/products/application/product-printing";
import type { ProductId } from "@mobile/features/products/domain/product";
import { makeCopyCount } from "@mobile/features/printing/domain/printing";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { expect, prepareVerifiedCompany, test } from "./fixtures";

function mobileProducts(request: APIRequestContext) {
  return createProductApi(async (path, init) => {
    const response = await request.fetch(path, {
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers)),
      data: typeof init?.body === "string" ? init.body : undefined,
    });
    const body: unknown = await response.json();
    return response.ok() ? ok(body) : err({ code: "API_ERROR", message: "Product request failed", http: { status: response.status(), body } });
  });
}

test("mobile prepares only the core-generated variant QR and rejects foreign or anonymous reads", async ({ page, request }) => {
  const emails = [`print-${crypto.randomUUID()}@example.test`, `print-other-${crypto.randomUUID()}@example.test`];
  try {
    await prepareVerifiedCompany(page, { email: emails[0], name: "Print owner", companyName: "Print owner", country: "PE" });
    const ownerProducts = mobileProducts(page.request);
    const id = crypto.randomUUID() as ProductId;
    expect(await ownerProducts.create({ id, name: "Camisa", currency: "PEN", variants: [{ attributes: {}, sku: "CAM-S", salePrice: 20 }] }))
      .toEqual({ success: true, data: id });
    const loaded = await ownerProducts.get(id);
    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error("Owner could not read created product");
    const copies = makeCopyCount(1);
    if (!copies.success) throw new Error("Invalid test copy count");
    let activeProducts = ownerProducts;
    const renderProductLabel = vi.fn(async () => ok({ uri: "file:///label.png", widthPx: 696, heightPx: 271 }));
    const printDocument = vi.fn(async ({ render }: Parameters<ProductPrintingDependencies["printDocument"]>[0]) => {
      await render({ widthPx: 696, heightPx: 271, dpiX: 300, dpiY: 300 });
      return ok({ status: "selection-required" as const });
    });
    const printing = createProductPrintingOperations({ loadProduct: (productId) => activeProducts.get(productId), renderProductLabel, printDocument });
    const execution = { isSessionCurrent: () => true, onStage: () => {} };
    expect(await printing.printProductLabel({ kind: "created-product", productId: id }, copies.data, execution))
      .toMatchObject({ success: true, data: { status: "selection-required" } });
    const raw = await page.request.get(`/api/products/${id}`);
    expect(raw.status()).toBe(200);
    const detail = productDetailResponseSchema.parse(await raw.json());
    expect(loaded.data.variants[0].qrCode).toBe(detail.product.variants[0].qrCode);
    expect(loaded.data.variants[0].qrCode).not.toBe(detail.product.qrCode);
    expect(renderProductLabel).toHaveBeenCalledWith({ productName: "Camisa", sku: "CAM-S", qrCode: detail.product.variants[0].qrCode }, expect.anything());

    await page.request.post("/api/auth/sign-out");
    await prepareVerifiedCompany(page, { email: emails[1], name: "Other owner", companyName: "Other owner", country: "PE" });
    renderProductLabel.mockClear();
    printDocument.mockClear();
    expect(await printing.printProductLabel({ kind: "created-product", productId: id }, copies.data, execution))
      .toMatchObject({ success: false, error: { cause: { code: "PRODUCT_NOT_FOUND" } } });
    activeProducts = mobileProducts(request);
    expect(await printing.printProductLabel({ kind: "created-product", productId: id }, copies.data, execution))
      .toMatchObject({ success: false, error: { cause: { code: "UNAUTHENTICATED" } } });
    expect(renderProductLabel).not.toHaveBeenCalled();
    expect(printDocument).not.toHaveBeenCalled();
  } finally {
    for (const email of emails) {
      const user = await systemPrisma.user.findUnique({ where: { email }, select: { companyId: true } });
      await systemPrisma.user.deleteMany({ where: { email } });
      if (!user?.companyId) continue;
      await withTenantIsolation(user.companyId, async () => {
        await prisma.productStock.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.productVariant.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.product.deleteMany({ where: { companyId: user.companyId! } });
        await prisma.company.delete({ where: { id: user.companyId! } });
      });
    }
  }
});
