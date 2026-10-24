import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { browserExpect, expect, prepareVerifiedCompany, storeUrl, subdomainOf } from "@core/tests/e2e/fixtures";
import { orders } from "@core/src/features/orders/composition";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { parseCompanyId, parseImageId } from "@core/src/features/store-appearance/domain/store-appearance";
import type { StoreThemeId } from "@shared/store-themes";
import { persistStoreAppearance } from "@core/src/features/store-appearance/infrastructure/store-appearance-repository";
import type { CompanyId, ContactId, OrderId, PositiveInteger, UserId } from "@core/src/features/orders/domain/order";
import type { VariantId } from "@core/src/features/products/domain/product";

type StoredAppearance = Readonly<{ theme: StoreThemeId; withLogo: boolean }>;

/** Saves the appearance of one company the way the editor will, without going through the UI. */
export async function saveCompanyAppearance(companyId: string, { theme, withLogo }: StoredAppearance) {
  const company = parseCompanyId(companyId);
  if (!company.success) throw new Error("Invalid company id for the appearance fixture");
  const imageId = withLogo ? randomUUID() : null;
  const logo = imageId ? parseImageId(imageId) : null;
  if (logo && !logo.success) throw new Error("Invalid image id for the appearance fixture");
  await withTenantIsolation(company.data, async () => {
    if (imageId) await prisma.image.create({ data: { id: imageId, storageKey: `logos/${imageId}.png` } });
    const saved = await persistStoreAppearance(company.data, { logoImageId: logo?.success ? logo.data : null, theme });
    if (!saved.success) throw new Error("Appearance fixture failed");
  });
}

const editorPath = "/es-PE/settings/store-appearance";

/** Signs up a company and opens its appearance editor; returns the company id. */
export async function openEditor(page: Page, email = `appearance-${crypto.randomUUID()}@example.test`) {
  const companyId = await prepareVerifiedCompany(page, { email, name: "Vendedora", companyName: "Lima Studio", country: "PE" });
  await page.goto(editorPath, { waitUntil: "networkidle" });
  await browserExpect(page.getByRole("heading", { name: "Apariencia de la tienda", level: 1 })).toBeVisible();
  return companyId;
}

/** A pending order of the company with its checkout enabled, as the seller shares it with a buyer. */
export async function sharedCheckoutPath(companyId: string, email: string) {
  const user = await systemPrisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const [tenant, userId, orderId, contactId] = [companyId as CompanyId, user.id as UserId, crypto.randomUUID() as OrderId, crypto.randomUUID() as ContactId];
  await withTenantIsolation(tenant, async () => {
    const product = await products.create({ name: "Cuaderno", currency: "PEN", variants: [{ attributes: { Color: "Azul" }, salePrice: 10, initialStock: 3 }] });
    if (!product.success) throw new Error("Product fixture failed");
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } });
    await prisma.contact.create({ data: { id: contactId, whatsappAccountId: "1@lid", whatsappLid: "2@lid" } });
    const created = await orders.create({ id: orderId, items: [{ variantId: variant.id as VariantId, quantity: 1 as PositiveInteger }] }, { companyId: tenant, userId });
    if (!created.success) throw new Error("Order fixture failed");
    await prisma.orderBuyer.create({ data: { orderId, contactId, name: "Ana", phone: "+51987654321" } });
    await prisma.company.update({ where: { id: tenant }, data: { catalogSubdomain: subdomainOf(companyId) } });
    expect(await orders.enableCheckout(orderId, { companyId: tenant, userId })).toMatchObject({ success: true });
  });
  return storeUrl(subdomainOf(companyId), `/checkout/${companyId}/${orderId}`);
}

export async function removeCompanyAppearance(companyId: string) {
  await withTenantIsolation(companyId, async () => {
    await prisma.companyCheckoutAppearance.deleteMany();
    await prisma.image.deleteMany();
  });
}

export const rgb = (hex: string) => {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
};

/** Every border color painted inside the checkout theme, as the browser computes it. */
export const usedBorderColors = (page: Page) => page.locator("[data-store-theme]").evaluate((root) =>
  [...new Set([root, ...root.querySelectorAll("*")]
    .filter((element) => parseFloat(getComputedStyle(element).borderTopWidth) > 0)
    .map((element) => getComputedStyle(element).borderTopColor))]);
