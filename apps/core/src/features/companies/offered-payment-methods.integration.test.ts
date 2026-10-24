import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { orders } from "@core/src/features/orders";
import { storeAppearance } from "@core/src/features/store-appearance/composition";

const companies: string[] = [];

afterAll(async () => {
  for (const companyId of companies) await withTenantIsolation(companyId, async () => {
    await prisma.orderItem.deleteMany();
    await prisma.orderBuyer.deleteMany();
    await prisma.order.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.product.deleteMany();
    await prisma.companyPaymentSettings.deleteMany();
    await prisma.image.deleteMany();
    await prisma.company.delete({ where: { id: companyId } });
  });
});

const imageId = randomUUID();
const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null };
const walletRow = (qr: unknown) => ({ method: "digital_wallet", provider: "Plin", holder: "Ana", ...(qr as object) });

/** A company with a buyer-confirmed order and the given stored payment settings, written the way each version stores them. */
async function company(settings: readonly unknown[]) {
  const companyId = randomUUID();
  const orderId = randomUUID();
  companies.push(companyId);
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: "Offered", country: "PE" } });
    await prisma.companyPaymentSettings.create({ data: { companyId, settings: settings as never } });
    const productId = randomUUID();
    const variantId = randomUUID();
    await prisma.product.create({ data: { id: productId, name: "Camisa", currency: "PEN", qrCode: productId,
      status: "active", createdAt: new Date(), updatedAt: new Date() } });
    await prisma.productVariant.create({ data: { id: variantId, productId, attributes: { Talla: "M" }, sku: `SKU-${variantId}`,
      salePrice: 10, qrCode: variantId, status: "active" } });
    await prisma.order.create({ data: { id: orderId, number: 1001n, fromCatalog: true, currency: "PEN", total: 10, itemsTotal: 10, createdAt: new Date(),
      checkoutEnabledAt: new Date(), checkoutConfirmedAt: new Date(), buyer: { create: { name: "Ana", phone: "+51987654321" } },
      items: { create: { variantId, productName: "Camisa", variantAttributes: { Talla: "M" }, sku: `SKU-${variantId}`, quantity: 1n, unitPrice: 10, subtotal: 10 } } } });
  });
  return { companyId, orderId };
}

const buyerMethods = async (orderId: string) => {
  const view = await orders.getBuyerPaymentView(orderId);
  if (!view.success) throw new Error(`buyer view failed: ${view.error.code}`);
  return view.data.settings.map((setting) => setting.method);
};

test("buyer view hides a wallet without a verified qr", async () => {
  const withImage = randomUUID();
  const verified = await company([walletRow({ qr: { status: "verified", imageId: withImage } }), bank]);
  await withTenantIsolation(verified.companyId, async () => await prisma.image.create({ data: { id: withImage, storageKey: `test/${withImage}` } }));
  const unchecked = await company([walletRow({ imageId: withImage }), bank]);
  expect(await buyerMethods(verified.orderId)).toEqual(["digital_wallet", "bank_transfer"]);
  expect(await buyerMethods(unchecked.orderId)).toEqual(["bank_transfer"]);
});

test("buyer view of a company with a pre-version wallet offers only bank transfer", async () => {
  for (const preVersion of [walletRow({ imageId: null }), walletRow({ imageId })]) {
    const { orderId } = await company([preVersion, bank]);
    expect(await buyerMethods(orderId)).toEqual(["bank_transfer"]);
  }
});

test("store-appearance checkout preview lists only offered payment methods", async () => {
  const { companyId } = await company([walletRow({ imageId }), bank]);
  const preview = await withTenantIsolation(companyId, () => storeAppearance.getPreview(companyId as never));
  expect(preview.success && preview.data.paymentMethods?.map((method) => method.method)).toEqual(["bank_transfer"]);
});
