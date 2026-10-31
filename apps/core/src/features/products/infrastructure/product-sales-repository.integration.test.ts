import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { products } from "@core/src/features/products/composition";
import { seedProduct, type SeedProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { ProductId } from "@core/src/features/products/domain/product";

const variant = (talla: string, color: string, stock: number, sku: string | null, status: "active" | "inactive" = "active") => ({ attributes: { Talla: talla, Color: color }, stock, sku, status });

async function store<T>(work: (seed: (product: SeedProduct) => ReturnType<typeof seedProduct>) => Promise<T>): Promise<T> {
  const companyId = randomUUID();
  await withTenantIsolation(companyId, async () => { await prisma.company.create({ data: { id: companyId, name: companyId, country: "PE" } }); });
  return withTenantIsolation(companyId, () => work((product) => seedProduct(product)));
}
const unwrap = <T>(result: { success: true; data: T } | { success: false; error: { message: string } }): T => { if (!result.success) throw new Error(result.error.message); return result.data; };

test("describes variants with the current product name, values in option order and the text match on name or any SKU", async () => {
  await store(async (seed) => {
    const polo = await seed({ name: "Polo básico", variants: [variant("M", "Azul", 5, "POL-M"), variant("L", "Negro", 0, "ZZ-ESPECIAL", "inactive")] });
    const gorro = await seed({ name: "Gorro", options: [], variants: [{ stock: 3, sku: "GOR-1" }] });
    const ids = [...polo.variantIds, ...gorro.variantIds];
    const found = unwrap(await products.describeVariantsForAssistant({ by: "variants", variantIds: ids }));
    expect(found).toHaveLength(3);
    const byId = new Map(found.map((row) => [row.variantId, row]));
    expect(byId.get(polo.variantIds[0]!)).toEqual({ variantId: polo.variantIds[0], productId: polo.productId, productName: "Polo básico", values: ["M", "Azul"], matchesText: true });
    expect(byId.get(polo.variantIds[1]!)).toMatchObject({ values: ["L", "Negro"] });
    expect(byId.get(gorro.variantIds[0]!)).toMatchObject({ productName: "Gorro", values: [] });
    const byName = unwrap(await products.describeVariantsForAssistant({ by: "variants", variantIds: ids, text: "POLO" }));
    expect(byName.filter((row) => row.matchesText).map((row) => row.productName)).toEqual(["Polo básico", "Polo básico"]);
    const bySku = unwrap(await products.describeVariantsForAssistant({ by: "variants", variantIds: ids, text: "zz-esp" }));
    expect(bySku.filter((row) => row.matchesText).map((row) => row.productName)).toEqual(["Polo básico", "Polo básico"]);
    const accents = unwrap(await products.describeVariantsForAssistant({ by: "variants", variantIds: ids, text: "basico" }));
    expect(accents.filter((row) => row.matchesText)).toHaveLength(2);
    expect(unwrap(await products.describeVariantsForAssistant({ by: "variants", variantIds: ids, text: "casaca" })).some((row) => row.matchesText)).toBe(false);
  });
});

test("describes one product of the store with all its variants by id and returns nothing for another store's product", async () => {
  let foreign: ProductId | undefined;
  await store(async (seed) => { foreign = (await seed({ name: "Ajeno", variants: [variant("M", "Azul", 1, null)] })).productId as ProductId; });
  await store(async (seed) => {
    const polo = await seed({ name: "Polo", variants: [variant("M", "Azul", 5, null), variant("L", "Negro", 2, null, "inactive")] });
    const found = unwrap(await products.describeVariantsForAssistant({ by: "product", productId: polo.productId as ProductId }));
    expect(found.map((row) => row.values.join("/")).sort()).toEqual(["L/Negro", "M/Azul"]);
    expect(found.every((row) => row.productName === "Polo")).toBe(true);
    expect(unwrap(await products.describeVariantsForAssistant({ by: "product", productId: foreign! }))).toEqual([]);
    expect(unwrap(await products.describeVariantsForAssistant({ by: "product", productId: randomUUID() as ProductId }))).toEqual([]);
  });
});

test("lists products with active stock today, counting store, matching and stocked products in one statement", async () => {
  await store(async (seed) => {
    const polo = await seed({ name: "Polo básico", createdAt: new Date("2026-10-01"), variants: [variant("M", "Azul", 20, "POL-1"), variant("L", "Negro", 2, "POL-2"), variant("S", "Rojo", 0, "POL-3")] });
    await seed({ name: "Casaca", createdAt: new Date("2026-10-02"), variants: [variant("M", "Negro", 4, "CAS-1")] });
    await seed({ name: "Chompa", createdAt: new Date("2026-11-02"), variants: [variant("M", "Negro", 9, "CHO-1")] });
    await seed({ name: "Short", createdAt: new Date("2026-10-01"), variants: [variant("M", "Negro", 0, "SHO-1")] });
    await seed({ name: "Vestido", createdAt: new Date("2026-10-01"), variants: [variant("M", "Negro", 7, "VES-1", "inactive")] });
    const all = unwrap(await products.listStockedForAssistant({ createdBefore: new Date("2026-11-01T05:00:00Z") }));
    expect(all).toMatchObject({ storeHasProducts: true, matching: 5, withStock: 3 });
    expect(all.checked.map((row) => row.name).sort()).toEqual(["Casaca", "Polo básico"]);
    const checkedPolo = all.checked.find((row) => row.name === "Polo básico")!;
    expect(checkedPolo).toMatchObject({ id: polo.productId, stock: { total: 22, soldOut: 1, low: 1, onlyLevel: null } });
    expect([...checkedPolo.variantIds].sort()).toEqual([...polo.variantIds].sort());
    expect(all.checked.find((row) => row.name === "Casaca")!.stock).toEqual({ total: 4, soldOut: 0, low: 0, onlyLevel: "available" });
    const some = unwrap(await products.listStockedForAssistant({ createdBefore: new Date("2026-11-01T05:00:00Z"), text: "casac" }));
    expect(some).toMatchObject({ storeHasProducts: true, matching: 1, withStock: 1 });
    const none = unwrap(await products.listStockedForAssistant({ createdBefore: new Date("2026-11-01T05:00:00Z"), text: "zapato" }));
    expect(none).toEqual({ storeHasProducts: true, matching: 0, withStock: 0, checked: [] });
  });
  await store(async () => {
    expect(unwrap(await products.listStockedForAssistant({ createdBefore: new Date() }))).toEqual({ storeHasProducts: false, matching: 0, withStock: 0, checked: [] });
  });
});

test("another store's products never appear in the stocked list or its counts", async () => {
  await store(async (seed) => { await seed({ name: "Polo ajeno", variants: [variant("M", "Azul", 50, "AJENO-1")] }); });
  await store(async (seed) => {
    await seed({ name: "Polo propio", variants: [variant("M", "Azul", 5, "PROPIO-1")] });
    const result = unwrap(await products.listStockedForAssistant({ createdBefore: new Date(Date.now() + 86_400_000), text: "polo" }));
    expect(result).toMatchObject({ matching: 1, withStock: 1 });
    expect(result.checked.map((row) => row.name)).toEqual(["Polo propio"]);
  });
});
