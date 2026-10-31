import { randomUUID } from "node:crypto";
import { ok } from "@shared/functional";
import { prisma, withinTransaction } from "@core/src/shared/infrastructure/persistance";
import { combinationKey } from "@core/src/features/products/domain/product-structure";
import type { OptionId, OptionValueId } from "@core/src/features/products/domain/product";

/** Performance seed of the assistant product search (technical design, section 7.3). Call inside withTenantIsolation. */
export type SearchStoreShape = Readonly<{
  /** Products with 2 options (Color × Talla) and 6 variants. */
  plainProducts: number;
  /** Products with 3 options and 30 colors each (90 variants), which brings the vocabulary to about 170 spellings. */
  wideProducts: number;
  /** Products with 100 variants (10 × 10), the largest the app allows. */
  hundredVariantProducts: number;
}>;

export const storeA: SearchStoreShape = { plainProducts: 1_949, wideProducts: 50, hundredVariantProducts: 1 };
export const storeB: SearchStoreShape = { plainProducts: 19_949, wideProducts: 50, hundredVariantProducts: 1 };

const colors = ["Azul", "Rojo", "Negro", "Blanco", "Verde", "Gris", "Beige", "Rosado"];
const sizes = ["S", "M", "L"];
const tones = Array.from({ length: 150 }, (_, index) => `Tono ${index + 1}`);
const materials = ["Algodón", "Lino", "Poliéster"];
const chunkSize = 500;

type Spec = Readonly<{ name: string; options: readonly (readonly [string, readonly string[]])[]; sku: string }>;

function specOf(kind: "plain" | "wide" | "hundred", index: number): Spec {
  switch (kind) {
    case "plain": {
      const first = index % colors.length;
      return { name: `Polo ${colors[first]} modelo ${index}`, sku: `plain-${index}`, options: [["Color", [colors[first]!, colors[(first + 3) % colors.length]!]], ["Talla", sizes]] };
    }
    case "wide":
      return { name: `Casaca ancha ${index}`, sku: `wide-${index}`, options: [["Color", tones.slice((index * 3) % 120, (index * 3) % 120 + 30)], ["Talla", sizes], ["Material", [materials[index % materials.length]!]]] };
    case "hundred":
      return { name: `Catálogo completo ${index}`, sku: `hundred-${index}`, options: [["Color", Array.from({ length: 10 }, (_, value) => `Color ${value}`)], ["Talla", Array.from({ length: 10 }, (_, value) => `T${value}`)]] };
  }
}

type Rows = { products: object[]; options: object[]; values: object[]; variants: object[]; stocks: object[]; links: object[] };

function rowsOf(spec: Spec, ordinal: number, now: Date, rows: Rows) {
  const productId = randomUUID();
  const options = spec.options.map(([name, values], position) => ({ id: randomUUID(), name, position, values: values.map((value, valuePosition) => ({ id: randomUUID(), value, position: valuePosition })) }));
  rows.products.push({ id: productId, name: spec.name, currency: "PEN", qrCode: productId, status: "active", createdAt: new Date(now.getTime() - ordinal * 1000), updatedAt: now, structureVersion: 1 });
  for (const option of options) {
    rows.options.push({ id: option.id, productId, name: option.name, position: option.position });
    for (const value of option.values) rows.values.push({ id: value.id, optionId: option.id, productId, name: value.value, position: value.position });
  }
  // Every combination of the options' values: 6 for a plain product, 90 for a wide one, 100 for the largest.
  let combinations: { optionId: string; valueId: string }[][] = [[]];
  for (const option of options) combinations = combinations.flatMap((prefix) => option.values.map((value) => [...prefix, { optionId: option.id, valueId: value.id }]));
  combinations.forEach((combination, position) => {
    const variantId = randomUUID();
    const draw = (ordinal * 31 + position * 7) % 100;
    rows.variants.push({ id: variantId, productId, combinationKey: combinationKey(Object.fromEntries(combination.map(({ optionId, valueId }) => [optionId, valueId])) as Record<OptionId, OptionValueId>),
      sku: `${spec.sku}-${position}`, salePrice: 10 + ((ordinal * 13 + position * 17) % 200) + ((position % 4) * 0.25), qrCode: randomUUID(), status: draw < 10 ? "inactive" : "active" });
    rows.stocks.push({ variantId, quantity: BigInt(draw < 30 ? 0 : draw < 55 ? 1 + (draw % 3) : 4 + draw) });
    for (const { optionId, valueId } of combination) rows.links.push({ productId, variantId, optionId, valueId });
  });
}

/** A chunk of about 3,000 variants and their links outlasts Prisma's 5 s default timer on a loaded machine. */
const seedChunkTimeoutMs = 120_000;

async function insertRows(rows: Rows) {
  const result = await withinTransaction(async () => {
    await prisma.product.createMany({ data: rows.products as never });
    await prisma.productOption.createMany({ data: rows.options as never });
    await prisma.productOptionValue.createMany({ data: rows.values as never });
    await prisma.productVariant.createMany({ data: rows.variants as never });
    await prisma.productStock.createMany({ data: rows.stocks as never });
    await prisma.productVariantOptionValue.createMany({ data: rows.links as never });
    return ok(null);
  }, { timeout: seedChunkTimeoutMs });
  if (!result.success) throw new Error("Unable to seed the search store");
}

const emptyRows = (): Rows => ({ products: [], options: [], values: [], variants: [], stocks: [], links: [] });

/** Inserts the stores of the performance check in chunks, with fixed shapes: 10 % of variants deactivated and stock spread over 0, 1–3 and higher. */
export async function seedSearchStore(shape: SearchStoreShape): Promise<Readonly<{ products: number; variants: number }>> {
  const now = new Date();
  const kinds: ("plain" | "wide" | "hundred")[] = [
    ...Array<"plain">(shape.plainProducts).fill("plain"), ...Array<"wide">(shape.wideProducts).fill("wide"), ...Array<"hundred">(shape.hundredVariantProducts).fill("hundred")];
  let rows = emptyRows();
  let variants = 0;
  for (const [ordinal, kind] of kinds.entries()) {
    rowsOf(specOf(kind, ordinal), ordinal, now, rows);
    if (rows.products.length === chunkSize || ordinal === kinds.length - 1) {
      variants += rows.variants.length;
      await insertRows(rows);
      rows = emptyRows();
    }
  }
  return { products: kinds.length, variants };
}
