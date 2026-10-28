import { randomUUID } from "node:crypto";
import { afterAll, expect, test, vi } from "vitest";
import type { CompanyId } from "@shared/identity";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { catalogStorefront } from "@core/src/features/catalog/composition";
import type { PublishedStorefront } from "@core/src/features/catalog/application/resolve-storefront";
import type { CatalogSearch } from "@core/src/features/catalog/domain/catalog";
import type { ProductId } from "@core/src/features/products/domain/product";
import { seedProduct, deleteSeededProducts } from "@core/src/features/products/infrastructure/product-seed";

type VariantSeed = { attributes?: Record<string, string>; sku?: string; price: number; purchasePrice?: number; stock: number; status?: "active" | "inactive" };
const companies: string[] = [];
let clock = Date.parse("2026-01-01T00:00:00.000Z");

const subdomainOf = (id: string) => `s${id.replaceAll("-", "").slice(0, 20)}` as CatalogSubdomain;
const resolve = (subdomain: CatalogSubdomain) => catalogStorefront.resolve({ kind: "store", subdomain });
/** What the brand host middleware hands the loaders: the company's resolved, published storefront. */
async function storefront(companyId: string): Promise<PublishedStorefront> {
  const resolved = await resolve(subdomainOf(companyId));
  if (!resolved.success || resolved.data.kind !== "published") throw new Error("Company is not published");
  return resolved.data;
}

async function createCompany(published: boolean) {
  const id = randomUUID() as CompanyId;
  companies.push(id);
  await withTenantIsolation(id, async () => await prisma.company.create({ data: { id, name: "Moda Lucía", country: "PE", catalogPublished: published, catalogSubdomain: published ? subdomainOf(id) : null } }));
  return id;
}

/** Each product is newer than the previous one. */
function addProduct(companyId: string, name: string, variants: VariantSeed[], options: { currency?: string; options?: { name: string; values: string[] }[] } = {}) {
  return withTenantIsolation(companyId, async () => {
    const id = randomUUID() as ProductId;
    const when = new Date(clock += 1000);
    await seedProduct({ id, name, currency: options.currency ?? "PEN", createdAt: when, updatedAt: when, options: options.options, variants: variants.map((variant) => ({
      attributes: variant.attributes ?? {}, sku: variant.sku, salePrice: variant.price, purchasePrice: variant.purchasePrice, stock: variant.stock, status: variant.status })) });
    return id;
  });
}

const browse = async (companyId: CompanyId, search: string | null = null, pages = 1) =>
  catalogBrowse.browse({ search: search as CatalogSearch | null, pages }, await storefront(companyId));

afterAll(async () => {
  for (const id of companies) await withTenantIsolation(id, async () => {
    await deleteSeededProducts();
    await prisma.company.deleteMany({ where: { id } });
  });
});

test("catalog projection never contains SKU, cost or stock quantity", async () => {
  const companyId = await createCompany(true);
  const productId = await addProduct(companyId, "Polo básico", [
    { attributes: { Color: "Negro", Talla: "M" }, sku: "SKU-SECRET-M", price: 45, purchasePrice: 12.34, stock: 150 },
    { attributes: { Color: "Negro", Talla: "L" }, sku: "SKU-SECRET-L", price: 49, purchasePrice: 13.57, stock: 0 },
  ]);
  await addProduct(companyId, "Producto en dólares", [{ price: 10, stock: 1 }], { currency: "USD" });

  const page = await browse(companyId);
  const detail = await catalogBrowse.getProduct(productId, await storefront(companyId));
  expect(page).toMatchObject({ success: true, data: { storeName: "Moda Lucía", hasMore: false, items: [{ id: productId }] } });
  expect(page.success && page.data.items).toHaveLength(1);
  expect(detail).toMatchObject({ success: true, data: { kind: "found", product: {
    price: { kind: "from", amount: { amount: 45, currency: "PEN" } }, soldOut: false,
    attributes: [{ name: "Color", values: ["Negro"] }, { name: "Talla", values: expect.arrayContaining(["M", "L"]) }],
  } } });
  if (!detail.success || detail.data.kind !== "found") return;
  expect(detail.data.product.variants.map(({ maxQuantity }) => maxQuantity).sort()).toEqual([0, 99]);
  const list = JSON.stringify(page);
  for (const detailOnly of ["maxQuantity", "variants", "attributes", "description"]) expect(list).not.toContain(detailOnly);
  for (const projection of [list, JSON.stringify(detail)])
    for (const secret of ["SKU-SECRET", "12.34", "13.57", "qrCode", "sku", "purchasePrice", "stock"]) expect(projection).not.toContain(secret);
});

test("the public catalog does not offer a deactivated variant", async () => {
  const companyId = await createCompany(true);
  const productId = await addProduct(companyId, "Polo básico", [
    { attributes: { Talla: "M" }, price: 45, stock: 3 },
    { attributes: { Talla: "L" }, price: 10, stock: 5, status: "inactive" },
  ]);
  const only = await addProduct(companyId, "Casaca", [{ attributes: { Talla: "S" }, price: 80, stock: 2, status: "inactive" }]);
  const detail = await catalogBrowse.getProduct(productId, await storefront(companyId));
  expect(detail).toMatchObject({ success: true, data: { kind: "found", product: { price: { kind: "single", amount: { amount: 45 } }, attributes: [{ name: "Talla", values: ["M"] }] } } });
  expect(detail.success && detail.data.kind === "found" && detail.data.product.variants).toHaveLength(1);
  const page = await browse(companyId);
  expect(page.success && page.data.items.map(({ id }) => id)).toEqual([productId]);
  expect(await catalogBrowse.getProduct(only, await storefront(companyId))).toMatchObject({ success: true, data: { kind: "unavailable" } });
});

test("products with only deactivated variants take no place in a page and the pages stay complete", async () => {
  const companyId = await createCompany(true);
  const visible: string[] = [];
  for (let index = 0; index < 30; index++) {
    visible.push(await addProduct(companyId, `Visible ${index}`, [{ attributes: { Talla: "S" }, price: 1 + index, stock: 1 }, { attributes: { Talla: "L" }, price: 100, stock: 0, status: "inactive" }]));
    await addProduct(companyId, `Oculto ${index}`, [{ attributes: { Talla: "S" }, price: 5, stock: 1, status: "inactive" }]);
  }
  const first = await browse(companyId);
  const second = await browse(companyId, null, 2);
  expect(first.success && first.data.items.map(({ id }) => id)).toEqual(visible.slice(6).reverse());
  expect(first).toMatchObject({ success: true, data: { hasMore: true } });
  expect(second.success && second.data.items.map(({ id }) => id)).toEqual(visible.reverse());
  expect(second).toMatchObject({ success: true, data: { hasMore: false } });
  // The card shows the active variants only: the inactive L at 100 is not the highest price.
  expect(first.success && first.data.items[0]).toMatchObject({ name: "Visible 29", price: { kind: "single", amount: { amount: 30 } }, soldOut: false });
});

test("search finds «POLO OVERSIZE» and «Polo básico» for «polo» and ignores accents", async () => {
  const companyId = await createCompany(true);
  const basico = await addProduct(companyId, "Polo básico", [{ price: 45, stock: 3 }]);
  await addProduct(companyId, "Casaca negra", [{ price: 120, stock: 1 }]);
  const oversize = await addProduct(companyId, "POLO OVERSIZE", [{ price: 59.9, stock: 0 }]);
  await addProduct(companyId, "Polo 100%_algodón", [{ price: 30, stock: 2 }]);

  const polo = await browse(companyId, "polo");
  expect(polo.success && polo.data.items.map(({ name }) => name)).toEqual(["Polo 100%_algodón", "POLO OVERSIZE", "Polo básico"]);
  expect(await browse(companyId, "BASICO")).toMatchObject({ success: true, data: { items: [{ id: basico }] } });
  expect(await browse(companyId, "óvérsízé")).toMatchObject({ success: true, data: { items: [{ id: oversize, soldOut: true }] } });
  expect(await browse(companyId, "%_")).toMatchObject({ success: true, data: { items: [{ name: "Polo 100%_algodón" }] } });
  expect(await browse(companyId, "polo rojo")).toMatchObject({ success: true, data: { items: [], hasMore: false } });

  for (let index = 0; index < 22; index++) await addProduct(companyId, `Producto ${index}`, [{ price: 1, stock: 1 }]);
  const first = await browse(companyId);
  expect(first).toMatchObject({ success: true, data: { hasMore: true } });
  expect(first.success && first.data.items).toHaveLength(24);
  expect(first.success && first.data.items[0].name).toBe("Producto 21");
  const all = await browse(companyId, null, 2);
  expect(all.success && all.data.items).toHaveLength(26);
  expect(all).toMatchObject({ success: true, data: { hasMore: false } });
});

test("an unpublished catalog and an unknown company return the same unavailable result", async () => {
  const hidden = await createCompany(false);
  await withTenantIsolation(hidden, async () => await prisma.company.update({ where: { id: hidden }, data: { catalogSubdomain: subdomainOf(hidden) } }));
  const released = await resolve("liberado" as CatalogSubdomain);
  const results = [await resolve(subdomainOf(hidden)), await resolve(subdomainOf(randomUUID())), await resolve("tienda" as CatalogSubdomain), released];
  for (const result of results) expect(result).toEqual({ success: true, data: { kind: "unavailable" } });
});

test("a product id of another company is unavailable inside the published store", async () => {
  const other = await createCompany(true);
  const productId = await addProduct(other, "Polo básico", [{ price: 45, stock: 3 }]);
  const published = await createCompany(true);
  expect(await catalogBrowse.getProduct(productId, await storefront(published))).toEqual({ success: true, data: { kind: "unavailable", storeName: "Moda Lucía" } });
  expect(await browse(published)).toMatchObject({ success: true, data: { items: [] } });
});

test("preview cards read a hidden catalog's products only for the seller's company", async () => {
  const hidden = await createCompany(false);
  const other = await createCompany(true);
  await addProduct(other, "Producto ajeno", [{ price: 5, stock: 1 }]);
  expect(await catalogBrowse.previewCards({ companyId: hidden })).toEqual({ success: true, data: [] });

  await addProduct(hidden, "Antiguo", [{ price: 10, stock: 1 }]);
  await addProduct(hidden, "Agotado", [{ price: 20, stock: 0 }]);
  await addProduct(hidden, "Medio", [{ price: 30, stock: 2 }]);
  await addProduct(hidden, "Nuevo", [{ price: 40, stock: 2 }]);
  const cards = await catalogBrowse.previewCards({ companyId: hidden });
  expect(cards.success && cards.data.map(({ name }) => name)).toEqual(["Nuevo", "Medio", "Agotado"]);
  expect(cards.success && cards.data.find(({ name }) => name === "Agotado")?.soldOut).toBe(true);
  expect(await resolve(subdomainOf(hidden))).toEqual({ success: true, data: { kind: "unavailable" } });
});

test("public catalog product hides inactive variants and orders selectors by saved order", async () => {
  const companyId = await createCompany(true);
  // Color is saved before Talla; Azul only has the inactive L / Azul and XL has no variant at all.
  const productId = await addProduct(companyId, "Polo básico", [
    { attributes: { Color: "Negro", Talla: "S" }, price: 45, stock: 3 },
    { attributes: { Color: "Negro", Talla: "L" }, price: 45, stock: 2 },
    { attributes: { Color: "Azul", Talla: "L" }, price: 45, stock: 5, status: "inactive" },
  ], { options: [{ name: "Color", values: ["Negro", "Azul"] }, { name: "Talla", values: ["S", "M", "L", "XL"] }] });
  const detail = await catalogBrowse.getProduct(productId, await storefront(companyId));
  expect(detail).toMatchObject({ success: true, data: { kind: "found", product: {
    attributes: [{ name: "Color", values: ["Negro"] }, { name: "Talla", values: ["S", "L"] }] } } });
  if (!detail.success || detail.data.kind !== "found") return;
  const combinations = detail.data.product.variants.map(({ attributes }) => JSON.stringify(Object.entries(attributes)));
  expect(combinations).toHaveLength(2);
  expect(combinations).toEqual(expect.arrayContaining([JSON.stringify([["Color", "Negro"], ["Talla", "S"]]), JSON.stringify([["Color", "Negro"], ["Talla", "L"]])]));
});

test("public catalog list computes price and sold out from active variants without loading variant rows", async () => {
  const companyId = await createCompany(true);
  const cheapRetired = await addProduct(companyId, "Casaca", [
    { attributes: { Talla: "S" }, price: 10, stock: 9, status: "inactive" },
    { attributes: { Talla: "M" }, price: 80, stock: 0 },
    { attributes: { Talla: "L" }, price: 80, stock: 0 },
  ]);
  const mixed = await addProduct(companyId, "Polo", [
    { attributes: { Talla: "S" }, price: 45, stock: 0 },
    { attributes: { Talla: "M" }, price: 49, stock: 2 },
  ]);
  const findMany = vi.spyOn(prisma.productVariant, "findMany");
  const page = await browse(companyId);
  expect(findMany).not.toHaveBeenCalled();
  findMany.mockRestore();
  expect(page.success && page.data.items).toEqual([
    expect.objectContaining({ id: mixed, soldOut: false, price: { kind: "from", amount: { amount: 45, currency: "PEN" } } }),
    expect.objectContaining({ id: cheapRetired, soldOut: true, price: { kind: "single", amount: { amount: 80, currency: "PEN" } } }),
  ]);
});
