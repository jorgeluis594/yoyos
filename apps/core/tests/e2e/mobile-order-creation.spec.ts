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
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true }, agency: { enabled: true },
      couriers: [{ kind: "new", name: "Journey courier", enabled: true }], store: { enabled: true, pickupPoint: { name: "Journey pickup", address: "Pickup street", instructions: null } },
    } })).status()).toBe(200);
    const zone = { kind: "new", enabled: true, districtCodes: ["150122"], price: { amount: 8, currency: "PEN" } };
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "home", expectedVersion: 1,
      zones: [{ ...zone, name: "Journey home" }, { ...zone, name: "Overlapping home", price: { amount: 12, currency: "PEN" } }],
    } })).status()).toBe(200);
    expect((await page.request.put("/api/delivery-settings/zones", { data: { method: "agency", expectedVersion: 2,
      zones: [{ ...zone, name: "Journey free agency", price: { amount: 0, currency: "PEN" } }],
    } })).status()).toBe(200);
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
      expect(saved).toHaveLength(8);
      expect(saved.filter(order => order.completedAt === null)).toHaveLength(7);
      for (const pending of saved.filter(order => order.completedAt === null && order.payments.length === 0))
        expect(pending).toMatchObject({ payments: [], stockDeducted: false, deliveryStatus: "pending", cancelled: false });
      expect(saved.find(order => order.completedAt !== null)).toMatchObject({ stockDeducted: true, deliveryStatus: "delivered", payments: [expect.any(Object)] });
      expect(saved.find(order => order.completedAt === null && order.payments.length > 0)).toMatchObject({
        itemsTotal: expect.any(Object), stockDeducted: true, deliveryStatus: "pending", payments: [expect.any(Object)],
      });
      const rated = saved.filter(order => order.delivery !== null);
      expect(rated).toHaveLength(5);
      expect(rated.map(order => String(order.deliveryCharge)).sort()).toEqual(["0", "10", "12", "12", "8"]);
      expect(await prisma.payment.count()).toBe(3);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity).toBe(3n);
    });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
  }
}, 180000);
