import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Synthetic catalog of a small Peruvian fashion business, in PEN. Names include near-duplicates («Polo básico», «Polo básico niño»,
 * «Polo premium») as hard negatives, and two products have no photo. Photos are listed in `images/manifest.json`.
 */

/** A product key is any string; it is validated against the loaded catalog (`assertKnownProducts`). */
export type ProductKey = string;

export const evalCatalogSchema = z.strictObject({
  products: z.array(z.strictObject({
    key: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    /** Photo of the product in the photo manifest, relative to the photo folder; absent or null when the product has none. */
    photo: z.string().nullable().default(null),
    /** False seeds the product with every variant inactive. */
    active: z.boolean().default(true),
    variants: z.array(z.strictObject({
      attributes: z.record(z.string(), z.string()),
      price: z.number().positive(),
      active: z.boolean().default(true),
    })).min(1),
  })).min(1),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  for (const { key } of value.products) {
    if (seen.has(key)) context.addIssue({ code: "custom", message: `Duplicated product key ${key}` });
    seen.add(key);
  }
});
export type EvalCatalog = z.output<typeof evalCatalogSchema>;
export type EvalCatalogInput = z.input<typeof evalCatalogSchema>;
export type CatalogVariant = EvalCatalog["products"][number]["variants"][number];
export type CatalogProduct = EvalCatalog["products"][number];

/** The company a catalog is seeded into: the committed one, or the private one of `EVAL_PRIVATE_DIR` runs. */
export type CatalogScope = "eval" | "private";

const sized = (sizes: readonly string[], colors: readonly string[], price: number) =>
  sizes.flatMap((size) => colors.map((color) => ({ attributes: { Talla: size, Color: color }, price })));

export const committedCatalog: EvalCatalog = evalCatalogSchema.parse({ products: [
  { key: "polo-basico", name: "Polo básico", photo: "catalog/polo-basico.jpg", variants: sized(["S", "M", "L"], ["Negro", "Blanco"], 35) },
  { key: "polo-premium", name: "Polo premium", photo: "catalog/polo-premium.jpg", variants: sized(["M", "L"], ["Negro", "Blanco"], 55) },
  { key: "polo-oversize", name: "Polo oversize", photo: "catalog/polo-oversize.jpg", variants: sized(["M", "L", "XL"], ["Verde"], 45) },
  { key: "polo-rayas", name: "Polo a rayas", photo: "catalog/polo-rayas.jpg", variants: sized(["S", "M", "L"], ["Azul"], 40) },
  { key: "polo-basico-nino", name: "Polo básico niño", variants: sized(["6", "8", "10"], ["Negro"], 25) },
  { key: "gorra-trucker", name: "Gorra trucker", photo: "catalog/gorra-trucker.jpg", variants: [{ attributes: { Color: "Negro" }, price: 25 }, { attributes: { Color: "Rojo" }, price: 25 }] },
  { key: "gorra-snapback", name: "Gorra snapback", photo: "catalog/gorra-snapback.jpg", variants: [{ attributes: { Color: "Azul" }, price: 30 }] },
  { key: "polera-capucha", name: "Polera con capucha", photo: "catalog/polera-capucha.jpg", variants: sized(["M", "L"], ["Gris", "Negro"], 89) },
  { key: "polera-cuello-redondo", name: "Polera cuello redondo", photo: "catalog/polera-cuello-redondo.jpg", variants: sized(["M", "L"], ["Beige"], 75) },
  { key: "chompa-tejida", name: "Chompa tejida", photo: "catalog/chompa-tejida.jpg", variants: [{ attributes: { Talla: "Única" }, price: 95 }] },
  { key: "medias-pack", name: "Medias deportivas pack x3", variants: [{ attributes: {}, price: 15 }] },
  { key: "correa-cuero", name: "Correa de cuero", photo: "catalog/correa-cuero.jpg", variants: [{ attributes: { Color: "Marrón" }, price: 39 }, { attributes: { Color: "Negro" }, price: 39 }] },
] });

/** The committed products, for the passes that only know the committed company. */
export const catalog: readonly CatalogProduct[] = committedCatalog.products;

const catalogs = new Map<CatalogScope, EvalCatalog>([["eval", committedCatalog]]);

/** Makes a loaded catalog known to the id lookups below. */
export function registerCatalog(scope: CatalogScope, loaded: EvalCatalog): void {
  catalogs.set(scope, loaded);
}

export const catalogOf = (scope: CatalogScope): EvalCatalog => catalogs.get(scope) ?? committedCatalog;

/** Fails when a case names a product the catalog does not have. */
export function assertKnownProducts(loaded: EvalCatalog, products: readonly string[]): void {
  const known = new Set(loaded.products.map(({ key }) => key));
  const missing = [...new Set(products.filter((key) => !known.has(key)))];
  if (missing.length) throw new Error(`Cases name products outside the catalog: ${missing.join(", ")}`);
}

/** A stable UUID for a fixture key, so case files, labels and the seeded database agree across runs. */
export function evalId(key: string): string {
  const hex = createHash("sha256").update(`yoyos-evals:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Ids are namespaced by company: the committed company keeps the original keys (printed QR labels carry them). */
const scoped = (scope: CatalogScope, key: string) => scope === "eval" ? key : `private:${key}`;
export const productIdOf = (product: ProductKey, scope: CatalogScope = "eval") => evalId(scoped(scope, `product:${product}`));

/** The variant key is the product key plus its attribute values in stored order: `polo-basico/M/Negro`. */
export const variantKey = (product: ProductKey, attributes: Readonly<Record<string, string>>) => [product, ...Object.values(attributes)].join("/");

/** Variant ids are their QR code too, as printed labels carry them. */
export const variantIdOf = (product: ProductKey, attributes: Readonly<Record<string, string>>, scope: CatalogScope = "eval") =>
  evalId(scoped(scope, `variant:${variantKey(product, attributes)}`));

const allScopes = (): readonly [CatalogScope, EvalCatalog][] => [...catalogs.entries()];

export const productById = (productId: string): CatalogProduct | null => {
  for (const [scope, loaded] of allScopes()) {
    const found = loaded.products.find((product) => productIdOf(product.key, scope) === productId);
    if (found) return found;
  }
  return null;
};

/** The variant of `product` whose attributes are exactly `attributes` (in any order), or undefined. */
export const variantOfCatalog = (loaded: EvalCatalog, product: ProductKey, attributes: Readonly<Record<string, string>>): CatalogVariant | undefined =>
  loaded.products.find(({ key }) => key === product)?.variants.find((variant) =>
    Object.keys(attributes).length === Object.keys(variant.attributes).length
    && Object.entries(attributes).every(([name, value]) => variant.attributes[name] === value));

/** Whether `known` names only attributes of one variant of `product`; with `incomplete`, that variant must also have attributes `known` leaves out. */
export const isPartOfAVariant = (loaded: EvalCatalog, product: ProductKey, known: Readonly<Record<string, string>>, incomplete: boolean): boolean =>
  loaded.products.find(({ key }) => key === product)?.variants.some((variant) =>
    Object.entries(known).every(([name, value]) => variant.attributes[name] === value)
    && (!incomplete || Object.keys(variant.attributes).length > Object.keys(known).length)) ?? false;

export function findVariant(product: ProductKey, attributes: Readonly<Record<string, string>>, scope: CatalogScope = "eval"): CatalogVariant {
  const found = variantOfCatalog(catalogOf(scope), product, attributes);
  if (!found) throw new Error(`Unknown catalog variant ${variantKey(product, attributes)}`);
  return found;
}

/** The product and attributes of a seeded variant id; null for ids outside the loaded catalogs. */
export function describeVariantId(variantId: string): Readonly<{ product: ProductKey; attributes: Readonly<Record<string, string>> }> | null {
  for (const [scope, loaded] of allScopes()) {
    for (const product of loaded.products) {
      for (const variant of product.variants) {
        if (variantIdOf(product.key, variant.attributes, scope) === variantId) return { product: product.key, attributes: variant.attributes };
      }
    }
  }
  return null;
}
