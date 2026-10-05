import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { loadPaymentSettings, persistPaymentSettings } from "@core/src/features/companies/infrastructure/payment-settings-repository";

const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", imageId: null } as const;
const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null } as const;

test("stores one settings collection per company and rejects cross-company reads", async () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  try {
    for (const companyId of [companyA, companyB]) await withTenantIsolation(companyId, async () =>
      await prisma.company.create({ data: { id: companyId, name: "Payment settings", country: "PE" } }));
    await withTenantIsolation(companyA, async () => {
      expect(await persistPaymentSettings(companyA, [wallet, bank])).toMatchObject({ success: true });
      expect(await loadPaymentSettings(companyA)).toMatchObject({ success: true, data: [wallet, bank] });
      expect(await loadPaymentSettings(companyB)).toMatchObject({ success: true, data: [] });
    });
    await withTenantIsolation(companyB, async () => {
      expect(await persistPaymentSettings(companyB, [bank])).toMatchObject({ success: true });
      expect(await loadPaymentSettings(companyB)).toMatchObject({ success: true, data: [bank] });
    });
    await withTenantIsolation(companyA, async () => {
      expect(await persistPaymentSettings(companyA, [wallet])).toMatchObject({ success: true });
      expect(await loadPaymentSettings(companyA)).toMatchObject({ success: true, data: [wallet] });
    });
    expect(await withTenantIsolation(companyA, async () => await prisma.companyPaymentSettings.count())).toBe(1);
    expect(await withTenantIsolation(companyB, async () => await prisma.companyPaymentSettings.count())).toBe(1);
    await withTenantIsolation(companyA, async () => await prisma.companyPaymentSettings.update({ where: { companyId: companyA }, data: { settings: [{ method: "unknown" }] } }));
    await withTenantIsolation(companyA, async () => {
      expect(await loadPaymentSettings(companyA)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    });
  } finally {
    for (const companyId of [companyA, companyB]) await withTenantIsolation(companyId, async () =>
      await prisma.company.deleteMany({ where: { id: companyId } }));
  }
});
