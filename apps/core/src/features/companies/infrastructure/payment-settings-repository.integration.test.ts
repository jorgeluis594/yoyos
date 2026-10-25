import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { loadPaymentSettings, persistPaymentSettings } from "@core/src/features/companies/infrastructure/payment-settings-repository";
import type { ImageId } from "@core/src/features/companies/domain/payment-settings";

const imageId = "00000000-0000-4000-8000-000000000001" as ImageId;
const wallet = { method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "verified", imageId } } as const;
const bank = { method: "bank_transfer", bank: "BCP", holder: "Ana", accountNumber: "00123", cci: null, imageId: null } as const;

test("stores and reads a verified wallet qr per company", async () => {
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

test("reads a row saved before this version as an unchecked wallet without rewriting it", async () => {
  const companyId = randomUUID();
  const preVersion = [{ method: "digital_wallet", provider: "Yape", holder: "Ana", imageId }, bank];
  try {
    await withTenantIsolation(companyId, async () => {
      await prisma.company.create({ data: { id: companyId, name: "Payment settings", country: "PE" } });
      await prisma.companyPaymentSettings.create({ data: { companyId, settings: preVersion } });
      expect(await loadPaymentSettings(companyId)).toMatchObject({ success: true,
        data: [{ method: "digital_wallet", provider: "Yape", holder: "Ana", qr: { status: "unchecked", imageId } }, bank] });
      expect((await prisma.companyPaymentSettings.findUniqueOrThrow({ where: { companyId } })).settings).toEqual(preVersion);
    });
  } finally {
    await withTenantIsolation(companyId, async () => await prisma.company.deleteMany({ where: { id: companyId } }));
  }
});
