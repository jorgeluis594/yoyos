import { createHash } from "node:crypto";

/**
 * Synthetic catalog of a small Peruvian fashion business, in PEN. Names include near-duplicates («Polo básico», «Polo básico niño»,
 * «Polo premium») as hard negatives, and two products have no photo. Photos are listed in `images/manifest.json`.
 */

export type ProductKey =
  | "polo-basico" | "polo-premium" | "polo-oversize" | "polo-rayas" | "polo-basico-nino"
  | "gorra-trucker" | "gorra-snapback" | "polera-capucha" | "polera-cuello-redondo" | "chompa-tejida"
  | "medias-pack" | "correa-cuero";

export type CatalogVariant = Readonly<{ attributes: Readonly<Record<string, string>>; price: number }>;
export type CatalogProduct = Readonly<{ key: ProductKey; name: string; photo: string | null; variants: readonly CatalogVariant[] }>;

const sized = (sizes: readonly string[], colors: readonly string[], price: number): CatalogVariant[] =>
  sizes.flatMap((size) => colors.map((color) => ({ attributes: { Talla: size, Color: color }, price })));

export const catalog: readonly CatalogProduct[] = [
  { key: "polo-basico", name: "Polo básico", photo: "catalog/polo-basico.jpg", variants: sized(["S", "M", "L"], ["Negro", "Blanco"], 35) },
  { key: "polo-premium", name: "Polo premium", photo: "catalog/polo-premium.jpg", variants: sized(["M", "L"], ["Negro", "Blanco"], 55) },
  { key: "polo-oversize", name: "Polo oversize", photo: "catalog/polo-oversize.jpg", variants: sized(["M", "L", "XL"], ["Verde"], 45) },
  { key: "polo-rayas", name: "Polo a rayas", photo: "catalog/polo-rayas.jpg", variants: sized(["S", "M", "L"], ["Azul"], 40) },
  { key: "polo-basico-nino", name: "Polo básico niño", photo: null, variants: sized(["6", "8", "10"], ["Negro"], 25) },
  { key: "gorra-trucker", name: "Gorra trucker", photo: "catalog/gorra-trucker.jpg", variants: [{ attributes: { Color: "Negro" }, price: 25 }, { attributes: { Color: "Rojo" }, price: 25 }] },
  { key: "gorra-snapback", name: "Gorra snapback", photo: "catalog/gorra-snapback.jpg", variants: [{ attributes: { Color: "Azul" }, price: 30 }] },
  { key: "polera-capucha", name: "Polera con capucha", photo: "catalog/polera-capucha.jpg", variants: sized(["M", "L"], ["Gris", "Negro"], 89) },
  { key: "polera-cuello-redondo", name: "Polera cuello redondo", photo: "catalog/polera-cuello-redondo.jpg", variants: sized(["M", "L"], ["Beige"], 75) },
  { key: "chompa-tejida", name: "Chompa tejida", photo: "catalog/chompa-tejida.jpg", variants: [{ attributes: { Talla: "Única" }, price: 95 }] },
  { key: "medias-pack", name: "Medias deportivas pack x3", photo: null, variants: [{ attributes: {}, price: 15 }] },
  { key: "correa-cuero", name: "Correa de cuero", photo: "catalog/correa-cuero.jpg", variants: [{ attributes: { Color: "Marrón" }, price: 39 }, { attributes: { Color: "Negro" }, price: 39 }] },
];

/** A stable UUID for a fixture key, so case files, labels and the seeded database agree across runs. */
export function evalId(key: string): string {
  const hex = createHash("sha256").update(`yoyos-evals:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The variant key is the product key plus its attribute values in stored order: `polo-basico/M/Negro`. */
export const variantKey = (product: ProductKey, attributes: Readonly<Record<string, string>>) => [product, ...Object.values(attributes)].join("/");

export const productById = (productId: string) => catalog.find((product) => evalId(`product:${product.key}`) === productId) ?? null;

/** Variant ids are their QR code too, as printed labels carry them. */
export function variantIdOf(product: ProductKey, attributes: Readonly<Record<string, string>>): string {
  return evalId(`variant:${variantKey(product, attributes)}`);
}

export function findVariant(product: ProductKey, attributes: Readonly<Record<string, string>>): CatalogVariant {
  const found = catalog.find(({ key }) => key === product)?.variants.find((variant) =>
    Object.keys(attributes).length === Object.keys(variant.attributes).length
    && Object.entries(attributes).every(([name, value]) => variant.attributes[name] === value));
  if (!found) throw new Error(`Unknown catalog variant ${variantKey(product, attributes)}`);
  return found;
}

/** The product and attributes of a seeded variant id; null for ids outside the eval catalog. */
export function describeVariantId(variantId: string): Readonly<{ product: ProductKey; attributes: Readonly<Record<string, string>> }> | null {
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (variantIdOf(product.key, variant.attributes) === variantId) return { product: product.key, attributes: variant.attributes };
    }
  }
  return null;
}
