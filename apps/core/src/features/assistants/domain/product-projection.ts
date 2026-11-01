import type { Currency, Money } from "@shared/money";
import { maxCombination, maxProductName, type Display } from "@core/src/features/assistants/domain/order-projection";

/**
 * The view of a product that agents receive. The projectable types are the only shapes the tools render; this file imports nothing from the products or catalog
 * features, `src/composition/assistant-product-capabilities.ts` maps those onto them. No type here can hold a QR code, a photo or an image URL,
 * and a search item has no field for the purchase price.
 */

export type ProjectableLevel = "sold_out" | "low" | "available";
export type ProjectableSku = Readonly<{ kind: "single"; sku: string | null }> | Readonly<{ kind: "several" }>;
export type ProjectableActive =
  | Readonly<{ kind: "none"; sku: ProjectableSku }>
  | Readonly<{ kind: "some"; minSalePrice: Money; hasDifferentPrices: boolean; totalStock: number; soldOut: number; low: number;
      onlyLevel: ProjectableLevel | null; sku: ProjectableSku }>;
export type ProjectableVariantLine = Readonly<{ values: readonly string[]; sku: string | null; salePrice: Money; stock: number; level: ProjectableLevel }>;
export type ProjectableProductSummary = Readonly<{ id: string; name: string; hidden: boolean; variantCount: number; inactiveCount: number;
  active: ProjectableActive; customerLink: string | null; matching: Readonly<{ variants: readonly ProjectableVariantLine[]; total: number }> | null }>;
export type ProjectableProduct = Readonly<{ id: string; name: string; hidden: boolean; description: string | null;
  options: readonly Readonly<{ name: string; values: readonly string[] }>[]; active: ProjectableActive; customerLink: string | null;
  variants: readonly (ProjectableVariantLine & Readonly<{ purchasePrice: Money | null; isActive: boolean; searched: boolean }>)[] }>;
export type ProjectableStorefront = Readonly<{ currency: Currency; catalog:
  Readonly<{ kind: "published"; storeLink: string }> | Readonly<{ kind: "hidden" }> | Readonly<{ kind: "hidden_without_link" }> }>;
export type ProjectableVocabulary = readonly Readonly<{ name: string; values: readonly string[] }>[];
export type ProjectableValueRejection =
  | Readonly<{ kind: "no_options" }>
  | Readonly<{ kind: "unknown_value"; written: string; vocabulary: ProjectableVocabulary }>
  | Readonly<{ kind: "value_in_other_option"; written: string; option: string; vocabulary: ProjectableVocabulary }>
  | Readonly<{ kind: "unknown_option"; option: string; vocabulary: ProjectableVocabulary }>;

export type ProductProjectionContext = Readonly<{ display: Display; appLink: (productId: string) => string }>;

/** What the agent asked for, as plain data; only the filters that narrow a search are described in an empty answer. */
export type AppliedFilters = Readonly<{
  text?: string; values?: readonly string[]; priceFromCents?: number; priceToCents?: number; stock?: "in_stock" | "low" | "sold_out"; inCatalog?: boolean;
}>;

type Level = "Agotado" | "Stock bajo";
export type InCatalogLine =
  | "En el catálogo" | "No está en el catálogo: producto oculto" | "No está en el catálogo: producto oculto y sin variantes activas" | "No está en el catálogo: sin variantes activas";
export type AssistantVariantMatch = Readonly<{ combinacion: string; sku: string; precio: string; stock: number; nivel?: Level }>;
export type AssistantProductSummary = Readonly<{
  id: string; nombre: string; sku: string; precio: string; stock?: string; en_catalogo: InCatalogLine; variantes: string; enlace: string; enlace_cliente?: string;
  variantes_coincidentes?: readonly AssistantVariantMatch[]; mas_variantes?: string;
}>;
export type AssistantProductVariant = Readonly<{
  combinacion: string; sku: string; precio: string; precio_compra: string; stock: number; nivel?: Level; estado: "Activa" | "Desactivada"; buscada_por_sku?: true;
}>;
export type AssistantProduct = Readonly<{
  catalogo: string; id: string; nombre: string; descripcion?: string; opciones: readonly Readonly<{ nombre: string; valores: readonly string[] }>[];
  en_catalogo: InCatalogLine; stock?: string; enlace: string; enlace_cliente?: string; variantes: readonly AssistantProductVariant[];
}>;

/** SKUs of a search item are shortened to this length; Ver producto shows them whole. */
export const maxSearchSku = 40;
export const maxDescription = 1000;
export const maxVocabularyValues = 100;
export const descriptionContinues = "… (la descripción continúa en Yoyos)";
const noSku = "Sin SKU";
const noPurchasePrice = "Sin precio de compra";
const noOptions = "Sin opciones";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The values of a variant joined by « / », cut at 50 characters; a product without options has the one variant «Sin opciones». */
export function combinationOf(values: readonly string[]): string {
  const present = values.filter((value) => value.trim() !== "");
  return present.length === 0 ? noOptions : clip(present.join(" / "), maxCombination);
}

/** The catalog sentence every answer carries, empty ones included. */
export function catalogLine(storefront: ProjectableStorefront): string {
  switch (storefront.catalog.kind) {
    case "published": return `Tu catálogo está publicado en ${storefront.catalog.storeLink}.`;
    case "hidden": return "Tu catálogo está oculto: ahora nadie ve tus productos.";
    case "hidden_without_link": return "Tu catálogo está oculto y no tiene link todavía.";
  }
}

/** «Stock: 12 · 1 agotada, 1 con stock bajo»; the product line only counts its variants' levels and never applies the threshold to the sum. `undefined` without active variants. */
export function stockLine(active: ProjectableActive): string | undefined {
  if (active.kind === "none") return undefined;
  const { totalStock, soldOut, low, onlyLevel } = active;
  if (totalStock === 0) return "Stock: 0 · Agotado";
  if (onlyLevel === "low") return `Stock: ${totalStock} · Stock bajo`;
  const levels = [...soldOut > 0 ? [`${soldOut} ${plural(soldOut, "agotada", "agotadas")}`] : [], ...low > 0 ? [`${low} con stock bajo`] : []];
  return levels.length === 0 ? `Stock: ${totalStock}` : `Stock: ${totalStock} · ${levels.join(", ")}`;
}

const skuLabel = (sku: ProjectableSku, max: number): string => sku.kind === "several" ? "Varias variantes" : sku.sku === null ? noSku : clip(sku.sku, max);
const priceLabel = (active: ProjectableActive, display: Display): string =>
  active.kind === "none" ? "Sin variantes activas" : `${active.hasDifferentPrices ? "Desde " : ""}${display.money(active.minSalePrice)}`;
/** «En el catálogo» means offered: not hidden and with an active variant; otherwise the line says why not. */
export function inCatalogLine(product: Readonly<{ hidden: boolean; active: ProjectableActive }>): InCatalogLine {
  const withVariants = product.active.kind === "some";
  if (!product.hidden) return withVariants ? "En el catálogo" : "No está en el catálogo: sin variantes activas";
  return withVariants ? "No está en el catálogo: producto oculto" : "No está en el catálogo: producto oculto y sin variantes activas";
}
const levelLabel = (level: ProjectableLevel): Level | undefined => level === "sold_out" ? "Agotado" : level === "low" ? "Stock bajo" : undefined;
const withLevel = (level: ProjectableLevel) => { const label = levelLabel(level); return label ? { nivel: label } : {}; };
const customerLinkField = (link: string | null) => link === null ? {} : { enlace_cliente: link };

const variantCountLine = (count: number, inactive: number) =>
  `${count} ${plural(count, "variante", "variantes")}${inactive > 0 ? `, ${inactive} ${plural(inactive, "desactivada", "desactivadas")}` : ""}`;

/** One search item; never the purchase price. */
export function toAssistantProductSummary(product: ProjectableProductSummary, context: ProductProjectionContext): AssistantProductSummary {
  const { display, appLink } = context;
  const stock = stockLine(product.active);
  const matching = product.matching;
  const more = matching === null ? 0 : matching.total - matching.variants.length;
  return {
    id: product.id, nombre: clip(product.name, maxProductName), sku: skuLabel(product.active.sku, maxSearchSku), precio: priceLabel(product.active, display),
    ...stock === undefined ? {} : { stock }, en_catalogo: inCatalogLine(product), variantes: variantCountLine(product.variantCount, product.inactiveCount),
    enlace: appLink(product.id), ...customerLinkField(product.customerLink),
    ...matching === null ? {} : { variantes_coincidentes: matching.variants.map((variant): AssistantVariantMatch => ({
      combinacion: combinationOf(variant.values), sku: variant.sku === null ? noSku : clip(variant.sku, maxSearchSku), precio: display.money(variant.salePrice),
      stock: variant.stock, ...withLevel(variant.level),
    })) },
    ...more > 0 ? { mas_variantes: `y ${more} ${plural(more, "variante", "variantes")} más: usa Ver producto` } : {},
  };
}

/** The Ver producto answer: every variant in saved order, the description cut at 1,000 characters. */
export function toAssistantProduct(product: ProjectableProduct, storefront: ProjectableStorefront, context: ProductProjectionContext): AssistantProduct {
  const { display, appLink } = context;
  const stock = stockLine(product.active);
  const description = product.description === null ? "" : product.description.trim();
  const characters = [...description];
  return {
    catalogo: catalogLine(storefront), id: product.id, nombre: clip(product.name, maxProductName),
    ...description === "" ? {} : { descripcion: characters.length > maxDescription ? `${characters.slice(0, maxDescription).join("")}${descriptionContinues}` : description },
    opciones: product.options.map((option) => ({ nombre: option.name, valores: [...option.values] })),
    en_catalogo: inCatalogLine(product), ...stock === undefined ? {} : { stock }, enlace: appLink(product.id), ...customerLinkField(product.customerLink),
    variantes: product.variants.map((variant): AssistantProductVariant => ({
      combinacion: combinationOf(variant.values), sku: variant.sku ?? noSku, precio: display.money(variant.salePrice),
      precio_compra: variant.purchasePrice === null ? noPurchasePrice : display.money(variant.purchasePrice), stock: variant.stock,
      ...variant.isActive ? withLevel(variant.level) : {}, estado: variant.isActive ? "Activa" : "Desactivada", ...variant.searched ? { buscada_por_sku: true as const } : {},
    })),
  };
}

function vocabularyLine(vocabulary: ProjectableVocabulary): string {
  const total = vocabulary.reduce((sum, option) => sum + option.values.length, 0);
  let remaining = maxVocabularyValues;
  const options: string[] = [];
  for (const option of vocabulary) {
    const shown = option.values.slice(0, remaining);
    remaining -= shown.length;
    if (shown.length > 0) options.push(`${option.name}: ${shown.join(", ")}`);
  }
  const hidden = total - maxVocabularyValues;
  return `Valores de tu tienda: ${options.join(" · ")}${hidden > 0 ? ` y ${hidden} ${plural(hidden, "valor", "valores")} más` : ""}.`;
}

/** The four texts of an unknown value or option, each with the store's values so the agent can retry in one call. */
export function vocabularyMessage(rejection: ProjectableValueRejection): string {
  switch (rejection.kind) {
    case "no_options": return "Ningún producto de tu tienda tiene opciones (como color o talla). Busca con texto.";
    case "unknown_value": return `Tu tienda no tiene el valor "${rejection.written}". ${vocabularyLine(rejection.vocabulary)}`;
    case "value_in_other_option": return `Tu tienda no tiene el valor "${rejection.written}" en ${rejection.option}. ${vocabularyLine(rejection.vocabulary)}`;
    case "unknown_option": return `Tu tienda no tiene la opción "${rejection.option}". ${vocabularyLine(rejection.vocabulary)}`;
  }
}

const stockNames = { in_stock: "con stock", low: "stock bajo", sold_out: "agotado" } as const;

/** «texto "polos", stock bajo, precio hasta S/ 30.00»: every filter the agent applied, in a fixed order. */
export function appliedFiltersLine(filters: AppliedFilters, currency: Currency, display: Display): string {
  const money = (cents: number) => display.money({ amount: cents / 100, currency });
  return [
    ...filters.text === undefined ? [] : [`texto "${filters.text}"`],
    ...filters.values === undefined ? [] : [`valores ${filters.values.map((value) => `"${value}"`).join(", ")}`],
    ...filters.priceFromCents === undefined ? [] : [`precio desde ${money(filters.priceFromCents)}`],
    ...filters.priceToCents === undefined ? [] : [`precio hasta ${money(filters.priceToCents)}`],
    ...filters.stock === undefined ? [] : [stockNames[filters.stock]],
    ...filters.inCatalog === undefined ? [] : [filters.inCatalog ? "en el catálogo" : "fuera del catálogo"],
  ].join(", ");
}

/** The message of an empty page: the applied filters, or that the store has no products at all. */
export function emptySearchMessage(filters: AppliedFilters, currency: Currency, storeHasProducts: boolean, display: Display): string {
  if (!storeHasProducts) return "Tu tienda todavía no tiene productos.";
  const applied = appliedFiltersLine(filters, currency, display);
  return applied === "" ? "No hay productos con esos filtros." : `No hay productos con esos filtros: ${applied}.`;
}

export const productsPerPage = 20;
/** «hay más: pide la página 2» while the page is not the last one. */
export const moreProductsLine = (page: number, total: number): string | undefined =>
  page * productsPerPage < total ? `hay más: pide la página ${page + 1}` : undefined;
