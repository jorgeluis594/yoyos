import { execFile } from "node:child_process";
import { deleteAgencies, insertAgency, seededCourier } from "@core/src/features/delivery-settings/infrastructure/courier-catalog-fixture";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, prepareVerifiedCompany, test } from "@core/tests/e2e/fixtures";
import { productEditing } from "@core/src/features/products/product-editing";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

test("mobile creation screen integrates with real order API, database and persisted recovery", async ({ page }) => {
  const email = `mobile-creation-${crypto.randomUUID()}@example.test`;
  let companyId: string | undefined;
  let agencyId: string | undefined;
  try {
    companyId = await prepareVerifiedCompany(page, { email, name: "Mobile seller", companyName: "Journey company", country: "PE" });
    const tenantId = companyId;
    const variantId = await withTenantIsolation(tenantId, async () => {
      const product = await productEditing.create({ name: "Journey product", currency: "PEN", options: [], variants: [{ values: [], salePrice: 10, initialStock: 5 }] });
      if (!product.success) throw new Error("Product setup failed");
      return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.data } })).id;
    });
    const courier = await seededCourier();
    agencyId = await insertAgency({ courierId: courier.id, name: "Journey branch" });
    expect((await page.request.put("/api/delivery-settings", { data: { expectedVersion: 0, home: { enabled: true }, agency: { enabled: true },
      store: { enabled: true, pickupPoint: { name: "Journey pickup", address: "Pickup street", instructions: null } },
    } })).status()).toBe(200);
    const zone = (name: string, amount: number) => ({ kind: "new", name, enabled: true, districtCodes: ["150122"],
      options: [{ kind: "new", method: "home", name, enabled: true, price: { amount, currency: "PEN" } }] });
    expect((await page.request.put("/api/delivery-settings/zones", { data: { expectedVersion: 1,
      zones: [zone("Journey home", 8), zone("Overlapping home", 12), { kind: "new", name: "Journey agency", enabled: true, districtCodes: ["150122"],
        options: [{ kind: "new", method: "agency", name: "Journey agency", enabled: true, price: { amount: 0, currency: "PEN" }, agencyIds: [agencyId] }] }],
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
      expect(saved).toHaveLength(10);
      expect(saved.filter(order => order.completedAt === null)).toHaveLength(8);
      for (const pending of saved.filter(order => order.completedAt === null && order.payments.length === 0))
        expect(pending).toMatchObject({ payments: [], stockDeducted: false, deliveryStatus: "pending", cancelled: false });
      expect(saved.filter(order => order.completedAt !== null)).toHaveLength(2);
      for (const completed of saved.filter(order => order.completedAt !== null))
        expect(completed).toMatchObject({ stockDeducted: true, deliveryStatus: "delivered", payments: [expect.any(Object)] });
      expect(saved.find(order => order.completedAt === null && order.payments.some(payment => String(payment.amount) === "18"))).toMatchObject({
        itemsTotal: expect.any(Object), stockDeducted: true, deliveryStatus: "pending", payments: [expect.any(Object)],
      });
      expect(saved.find(order => order.payments.some(payment => String(payment.amount) === "40"))).toMatchObject({ stockDeducted: true, deliveryStatus: "delivered", delivery: null });
      expect(saved.find(order => order.payments.some(payment => String(payment.amount) === "4.5"))).toMatchObject({ stockDeducted: false });
      const rated = saved.filter(order => order.delivery !== null);
      expect(rated).toHaveLength(6);
      expect(rated.map(order => String(order.deliveryCharge)).sort()).toEqual(["0", "10", "12", "12", "12", "8"]);
      expect(await prisma.payment.count()).toBe(4);
      expect((await prisma.productStock.findUniqueOrThrow({ where: { variantId } })).quantity).toBe(2n);
    });
  } finally {
    if (companyId) await withTenantIsolation(companyId, async () => {
      await prisma.payment.deleteMany(); await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
      await prisma.productStock.deleteMany(); await prisma.productVariant.deleteMany(); await prisma.productOption.deleteMany(); await prisma.product.deleteMany();
      await prisma.deliveryRate.deleteMany(); await prisma.quotation.deleteMany();
      await prisma.deliveryZoneDistrict.deleteMany(); await prisma.deliveryOptionAgency.deleteMany(); await prisma.deliveryOption.deleteMany(); await prisma.deliveryZone.deleteMany();
      await prisma.companyCourier.deleteMany(); await prisma.companyDeliverySettings.deleteMany();
      await systemPrisma.user.deleteMany({ where: { email } }); await prisma.company.delete({ where: { id: companyId } });
    });
    if (agencyId) await deleteAgencies([agencyId]);
  }
}, 180000);
