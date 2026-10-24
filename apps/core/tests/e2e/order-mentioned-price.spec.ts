import { browserExpect, expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("the seller sees the buyer's mentioned price under the unit price of an order item", async ({ page }) => {
  const email = `mentioned-price-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Seller", companyName: "Mentioned price", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Gorra", currency: "PEN", variants: [{ attributes: {}, salePrice: 25, initialStock: 10 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    const orderWithMention = async (amount: number, units: number) => {
      const id = crypto.randomUUID();
      expect((await page.request.post("/api/orders", { data: { id, items: [{ variantId, quantity: 3 }] } })).status()).toBe(201);
      await withTenantIsolation(tenantId, async () => await prisma.orderItem.updateMany({ where: { orderId: id }, data: { mentionedPriceAmount: amount, mentionedPriceUnits: units } }));
      return id;
    };
    await page.goto(`/es-PE/orders/${await orderWithMention(50, 3)}`);
    await browserExpect(page.getByText("El cliente mencionó S/ 50.00 por 3", { exact: true })).toBeVisible();
    await page.goto(`/es-PE/orders/${await orderWithMention(20, 1)}`);
    await browserExpect(page.getByText("El cliente mencionó S/ 20.00 por unidad", { exact: true })).toBeVisible();
    await page.goto(`/es-PE/orders/${await orderWithMention(75, 3)}`);
    await browserExpect(page.getByText("Gorra", { exact: true })).toBeVisible();
    await browserExpect(page.getByText(/El cliente mencionó/)).toHaveCount(0);
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } });
      await prisma.company.delete({ where: { id: companyId } });
    });
  }
});
