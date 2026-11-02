import { randomUUID } from "node:crypto";
import { browserExpect, expect, prepareVerifiedCompany, publishCatalog, test } from "@core/tests/e2e/fixtures";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";

const baseURL = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;

test("the seller hides a product and the buyer no longer sees it in the catalog", async ({ page }) => {
  const email = `hide-seller-${randomUUID()}@example.test`;
  const companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Tienda oculta", country: "PE" });
  const buyer = await page.context().browser()!.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const buyerPage = await buyer.newPage();
  try {
    await withTenantIsolation(companyId, () => seedProduct({ name: "Polo básico", variants: [{ salePrice: 45, stock: 5 }] }));
    const hidden = await withTenantIsolation(companyId, () => seedProduct({ name: "Casaca jean", variants: [{ salePrice: 120, stock: 5 }] }));
    const storeAddress = await publishCatalog(companyId);

    await buyerPage.goto(storeAddress);
    await browserExpect(buyerPage.getByRole("link", { name: /Casaca jean/ })).toBeVisible();
    await browserExpect(buyerPage.getByRole("link", { name: /Polo básico/ })).toBeVisible();

    // The seller hides «Casaca jean» through the same API the product form saves with, changing nothing else.
    const detail = await page.request.get(`/api/products/${hidden.productId}`);
    expect(detail.status()).toBe(200);
    const { product } = await detail.json();
    const saved = await page.request.put(`/api/products/${hidden.productId}`, { data: {
      structureVersion: product.structureVersion, name: product.name, description: product.description, hidden: true, options: [],
      variants: product.variants.map((variant: { id: string; sku: string | null; salePrice: { amount: number }; purchasePrice: { amount: number } | null }) =>
        ({ id: variant.id, sku: variant.sku, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null })),
      newVariants: [], deletedVariantIds: [],
    } });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({ product: { hidden: true }, catalogEmptied: false });

    await buyerPage.goto(storeAddress);
    await browserExpect(buyerPage.getByRole("link", { name: /Polo básico/ })).toBeVisible();
    await browserExpect(buyerPage.getByRole("link", { name: /Casaca jean/ })).toHaveCount(0);
    await browserExpect(async () => {
      await buyerPage.getByRole("searchbox", { name: "Buscar productos" }).fill("casaca");
      await buyerPage.waitForURL(/\?q=casaca$/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await browserExpect(buyerPage.getByRole("link", { name: /Casaca jean/ })).toHaveCount(0);

    // The product page is gone for the buyer, but the seller still has the product.
    const page404 = await buyerPage.goto(`${storeAddress}productos/${hidden.productId}`);
    expect(page404?.status()).toBe(404);
    await browserExpect(buyerPage.getByText("Este producto ya no está disponible")).toBeVisible();
    expect((await page.request.get(`/api/products/${hidden.productId}`)).status()).toBe(200);
  } finally {
    await buyer.close();
    await withTenantIsolation(companyId, async () => {
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
