import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withinTransaction, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { dispatchSender } from "@core/src/features/dispatch-sender/composition";
import { loadDispatchSender, persistDispatchSender } from "@core/src/features/dispatch-sender/infrastructure/dispatch-sender-repository";

test("stores one sender per company, falls back to the current company name and isolates companies", async () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  try {
    for (const [companyId, name] of [[companyA, "Negocio A"], [companyB, "Negocio B"]] as const) await withTenantIsolation(companyId, async () =>
      await prisma.company.create({ data: { id: companyId, name, country: "PE" } }));
    await withTenantIsolation(companyA, async () => {
      expect(await dispatchSender.get(companyA)).toEqual({ success: true, data: { configured: { name: null, phone: null }, effective: { name: "Negocio A", phone: null } } });
      expect(await dispatchSender.save(companyA, randomUUID(), { name: " Fantastidog ", phone: " 977 000 111 " })).toMatchObject({ success: true,
        data: { configured: { name: "Fantastidog", phone: "977 000 111" }, effective: { name: "Fantastidog", phone: "977 000 111" } } });
      expect(await loadDispatchSender(companyB)).toMatchObject({ success: true, data: null });
    });
    await withTenantIsolation(companyB, async () => {
      expect(await dispatchSender.get(companyB)).toMatchObject({ success: true, data: { configured: { name: null, phone: null }, effective: { name: "Negocio B" } } });
      expect(await persistDispatchSender(companyA, { name: "Intruso", phone: null })).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(await prisma.companyDispatchSender.count()).toBe(0);
    });
    await withTenantIsolation(companyA, async () => {
      expect(await dispatchSender.save(companyA, randomUUID(), { name: "", phone: "999" })).toMatchObject({ success: true,
        data: { configured: { name: null, phone: "999" }, effective: { name: "Negocio A", phone: "999" } } });
      await prisma.company.update({ where: { id: companyA }, data: { name: "Negocio Renombrado" } });
      expect(await dispatchSender.get(companyA)).toMatchObject({ success: true, data: { effective: { name: "Negocio Renombrado", phone: "999" } } });
      expect(await prisma.companyDispatchSender.count()).toBe(1);
    });
    await withTenantIsolation(companyA, async () => {
      const inside = await withinTransaction(async () => dispatchSender.get(companyA));
      expect(inside).toMatchObject({ success: true, data: { effective: { name: "Negocio Renombrado" } } });
    });
  } finally {
    for (const companyId of [companyA, companyB]) await withTenantIsolation(companyId, async () =>
      await prisma.company.deleteMany({ where: { id: companyId } }));
  }
});

test("the database refuses a name over 120 characters or a phone over 30", async () => {
  const companyId = randomUUID();
  try {
    await withTenantIsolation(companyId, async () => {
      await prisma.company.create({ data: { id: companyId, name: "Limites", country: "PE" } });
      expect(await persistDispatchSender(companyId, { name: "n".repeat(121), phone: null })).toMatchObject({ success: false });
      expect(await persistDispatchSender(companyId, { name: null, phone: "1".repeat(31) })).toMatchObject({ success: false });
      expect(await persistDispatchSender(companyId, { name: "n".repeat(120), phone: "1".repeat(30) })).toMatchObject({ success: true });
    });
  } finally {
    await withTenantIsolation(companyId, async () => await prisma.company.deleteMany({ where: { id: companyId } }));
  }
});
