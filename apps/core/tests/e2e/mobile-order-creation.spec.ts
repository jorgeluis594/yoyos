import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { products } from "@core/src/features/products/composition";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("mobile creation screen integrates with real order API, database and persisted recovery", async ({ page }) => {
  const email = `mobile-creation-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Mobile seller", companyName: "Journey company", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await products.create({ name: "Journey product", currency: "PEN", variants: [{ attributes: {}, salePrice: 10, initialStock: 5 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    const cookie = (await page.context().cookies()).map(value => `${value.name}=${value.value}`).join("; ");
    try {
      await promisify(execFile)(process.execPath, ["node_modules/jest/bin/jest.js", "--runInBand", "--testMatch", "**/new-order-screen.integration.tsx"], {
        cwd: resolve(process.cwd(), "../mobile"), timeout: 120000,
        env: { ...process.env, ORDER_JOURNEY_ORIGIN: `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`,
          ORDER_JOURNEY_COMPANY: tenantId, ORDER_JOURNEY_COOKIE: cookie },
      });
    } catch (cause) {
      const output = cause as { stdout?: string; stderr?: string };
      throw new Error(`Mobile integration failed:\n${output.stdout ?? ""}\n${output.stderr ?? ""}`, { cause });
    }
    await withTenantIsolation(tenantId, async () => {
      const saved = await prisma.order.findMany({ include: { payments: true } });
      expect(saved).toHaveLength(3);
      expect(saved.filter(order => order.completedAt === null)).toHaveLength(2);
      for (const pending of saved.filter(order => order.completedAt === null))
        expect(pending).toMatchObject({ payments: [], stockDeducted: false, deliveryStatus: "pending", cancelled: false });
      expect(saved.find(order => order.completedAt !== null)).toMatchObject({ stockDeducted: true, deliveryStatus: "delivered", payments: [expect.any(Object)] });
      expect(await prisma.payment.count()).toBe(1);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity).toBe(4n);
    });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 180000);
