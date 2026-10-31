import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import { prisma, withTenantIsolation, withinTransaction, inActiveTransaction } from "@core/src/shared/infrastructure/persistance";
import type { CompanyId } from "@core/src/features/catalog/application/catalog-settings";
import { readCatalogSettings, readStorefrontState, resolveSubdomain, saveSubdomain, savePublication } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";

const companies: string[] = [];
const unique = () => `s${randomUUID().replaceAll("-", "").slice(0, 20)}` as CatalogSubdomain;

async function company(data: { name?: string; country?: string; catalogPublished?: boolean; catalogSubdomain?: string | null } = {}) {
  const id = randomUUID() as CompanyId;
  companies.push(id);
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Moda Lucía", country: "PE", ...data } }));
  return id;
}

afterAll(async () => {
  for (const id of companies) await withTenantIsolation(id, async () => await prisma.company.delete({ where: { id } }));
});

test("two companies saving fantasio at the same time: exactly one keeps it, the other gets SUBDOMAIN_TAKEN", async () => {
  const [first, second] = [await company({ catalogSubdomain: unique() }), await company({ catalogSubdomain: unique() })];
  const previous = new Map<string, string | null>();
  for (const id of [first, second]) previous.set(id, await withTenantIsolation(id, async () => (await prisma.company.findUniqueOrThrow({ where: { id } })).catalogSubdomain));
  const contested = unique();
  const results = await Promise.all([first, second].map((id) => withTenantIsolation(id, () => saveSubdomain(id, contested))));
  expect(results.filter((result) => result.success)).toHaveLength(1);
  expect(results.filter((result) => !result.success)).toEqual([{ success: false, error: expect.objectContaining({ code: "SUBDOMAIN_TAKEN" }) }]);
  for (const [index, id] of [first, second].entries()) {
    const stored = await withTenantIsolation(id, async () => (await prisma.company.findUniqueOrThrow({ where: { id } })).catalogSubdomain);
    expect(stored).toBe(results[index].success ? contested : previous.get(id));
  }
});

test("changing the subdomain releases the previous one for another company in the same commit", async () => {
  const previous = unique();
  const owner = await company({ catalogSubdomain: previous });
  const other = await company();
  const taken = await withTenantIsolation(other, () => saveSubdomain(other, previous));
  expect(taken).toMatchObject({ success: false, error: { code: "SUBDOMAIN_TAKEN" } });
  expect((await withTenantIsolation(owner, () => saveSubdomain(owner, unique()))).success).toBe(true);
  expect((await withTenantIsolation(other, () => saveSubdomain(other, previous))).success).toBe(true);
  expect(await withTenantIsolation(other, () => readCatalogSettings(other))).toMatchObject({ success: true, data: { subdomain: previous } });
});

test("the database rejects a published catalog without a subdomain", async () => {
  const id = await company();
  await expect(withTenantIsolation(id, async () => await prisma.company.update({ where: { id }, data: { catalogPublished: true } }))).rejects.toThrow();
  const withSubdomain = await company({ catalogSubdomain: unique() });
  await expect(withTenantIsolation(withSubdomain, async () => await prisma.company.update({ where: { id: withSubdomain }, data: { catalogPublished: true } }))).resolves.toBeDefined();
});

test("the database rejects a subdomain outside the format", async () => {
  const id = await company();
  for (const value of ["ab", "Fantasio", "fan--tasio", "-fantasio", "fantasio-", "fan.tasio", "a".repeat(31), "pañales"])
    await expect(withTenantIsolation(id, async () => await prisma.company.update({ where: { id }, data: { catalogSubdomain: value } })), value).rejects.toThrow();
  expect(await withTenantIsolation(id, () => readCatalogSettings(id))).toMatchObject({ success: true, data: { subdomain: null } });
});

test("savePublication publishes only with a subdomain, hides always and reads back the settings", async () => {
  const subdomain = unique();
  const without = await company();
  expect(await withTenantIsolation(without, () => savePublication(without, true))).toEqual({ success: true, data: "subdomain_missing" });
  expect(await withTenantIsolation(without, () => savePublication(without, false))).toEqual({ success: true, data: "saved" });
  const withName = await company({ catalogSubdomain: subdomain });
  expect(await withTenantIsolation(withName, () => savePublication(withName, true))).toEqual({ success: true, data: "saved" });
  expect(await withTenantIsolation(withName, () => readCatalogSettings(withName))).toEqual({ success: true, data: { published: true, subdomain, companyName: "Moda Lucía" } });
  expect(await withTenantIsolation(withName, () => savePublication(withName, false))).toEqual({ success: true, data: "saved" });
});

test("resolves owner, publication and store of a subdomain across companies in one call without exposing other company rows", async () => {
  const subdomain = unique();
  const owner = await company({ catalogSubdomain: subdomain, catalogPublished: true, name: "Café Fantasío", country: "CO" });
  const caller = await company();
  expect(await withTenantIsolation(caller, async () => await prisma.company.findUnique({ where: { id: owner } }))).toBeNull();
  expect(await withTenantIsolation(caller, () => resolveSubdomain(subdomain)))
    .toEqual({ success: true, data: { companyId: owner, published: true, store: { name: "Café Fantasío", currency: "COP" } } });
  expect(await withTenantIsolation(caller, () => resolveSubdomain(unique()))).toEqual({ success: true, data: null });
});

test("a company cannot update another company's subdomain", async () => {
  const subdomain = unique();
  const victim = await company({ catalogSubdomain: subdomain });
  const attacker = await company();
  const result = await withTenantIsolation(attacker, () => saveSubdomain(victim, unique()));
  expect(result.success).toBe(false);
  expect(await withTenantIsolation(victim, () => readCatalogSettings(victim))).toMatchObject({ success: true, data: { subdomain } });
});

test("reads null for a company that is not visible", async () => {
  const hidden = await company();
  const caller = await company();
  expect(await withTenantIsolation(caller, () => readCatalogSettings(hidden))).toEqual({ success: true, data: null });
});

test("describes a published, a hidden and a never-linked catalog with the store currency", async () => {
  const [published, hidden] = [unique(), unique()];
  const peru = await company({ catalogSubdomain: published, catalogPublished: true });
  const brazil = await company({ country: "BR", catalogSubdomain: hidden });
  const unlinked = await company();
  expect(await withTenantIsolation(peru, () => readStorefrontState(peru))).toEqual({ success: true, data: { currency: "PEN", catalog: { kind: "published", subdomain: published } } });
  expect(await withTenantIsolation(brazil, () => readStorefrontState(brazil))).toEqual({ success: true, data: { currency: "BRL", catalog: { kind: "hidden", subdomain: hidden } } });
  expect(await withTenantIsolation(unlinked, () => readStorefrontState(unlinked))).toEqual({ success: true, data: { currency: "PEN", catalog: { kind: "hidden_without_link" } } });
});

test("reports an absent company as unavailable", async () => {
  const absent = randomUUID() as CompanyId;
  expect(await withTenantIsolation(absent, () => readStorefrontState(absent))).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
});

test("reads the storefront inside the caller's snapshot without a transaction of its own", async () => {
  const subdomain = unique();
  const id = await company({ catalogSubdomain: subdomain, catalogPublished: true });
  const transactionId = async () => (await prisma.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`)[0].id;
  const observed = await withTenantIsolation(id, () => withinTransaction(async () => {
    const before = await transactionId();
    const state = await readStorefrontState(id);
    return { success: true as const, data: { before, after: await transactionId(), active: inActiveTransaction(), state } };
  }));
  if (!observed.success) throw new Error("transaction failed");
  expect(observed.data.active).toBe(true);
  expect(observed.data.after).toBe(observed.data.before);
  expect(observed.data.state).toEqual({ success: true, data: { currency: "PEN", catalog: { kind: "published", subdomain } } });
});
