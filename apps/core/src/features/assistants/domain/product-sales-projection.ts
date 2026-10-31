import type { Currency, Money } from "@shared/money";
import { centsOf, sharePercent, type Share } from "@core/src/features/assistants/domain/sales-figures";
import { productsPerPage, type ProjectableLevel } from "@core/src/features/assistants/domain/product-projection";

/**
 * The pure rules of the two product sales tools: grouping sold variants by product, ranking, paging, and the order of the unsold list.
 * The projectable types are the assistant's own; `src/composition/assistant-product-sales-capabilities.ts` maps the orders and products types onto them.
 */
export type ProjectableSoldVariant = Readonly<{ variantId: string; currency: Currency; units: number; amount: Money }>;
export type ProjectableCurrencyTotals = Readonly<{ currency: Currency; orders: number; units: number; amount: Money }>;
export type ProjectableSold = Readonly<{ variants: readonly ProjectableSoldVariant[]; currencies: readonly ProjectableCurrencyTotals[] }>;
export type ProjectableDescribedVariant = Readonly<{ variantId: string; productId: string; productName: string; values: readonly string[]; matchesText: boolean }>;

/** At most this many variants are shown under a product of the ranking; a single product shows all. */
export const variantsPerProduct = 3;

const collator = new Intl.Collator("es", { sensitivity: "base" });
const byName = (a: string, b: string) => collator.compare(a, b);
const money = (cents: number, currency: Currency): Money => ({ amount: cents / 100, currency });

export type RankedVariant = Readonly<{ combination: string; units: number; amount: Money }>;
export type RankedProduct = Readonly<{
  productId: string; name: string; units: number; amount: Money; share: Share;
  variants: readonly RankedVariant[];     // best first; empty for a product without options
  moreVariants: number;                   // variants sold that are not in `variants`
}>;
export type SoldRanking = Readonly<{
  total: number;                          // products ranked (matching `texto`)
  units: number; amount: Money;           // of the ranked products
  wholeAmount: Money;                     // the store currency's product amount of the whole period: the denominator of every share
  page: number; items: readonly RankedProduct[];
}>;
export type RankOptions = Readonly<{ order: "units" | "amount"; page: number; storeCurrency: Currency; text?: string }>;

type Group = { productId: string; name: string; units: number; cents: number; variants: { combination: string; units: number; cents: number }[]; hasOptions: boolean };

/** Store-currency variants grouped by product; a variant without a description (it cannot happen: items reference variants) is skipped, as is one of a product not matching `texto`. */
function groupByProduct(sold: ProjectableSold, described: readonly ProjectableDescribedVariant[], currency: Currency): Group[] {
  const info = new Map(described.map((variant) => [variant.variantId, variant] as const));
  const groups = new Map<string, Group>();
  for (const row of sold.variants) {
    const variant = info.get(row.variantId);
    if (row.currency !== currency || !variant?.matchesText) continue;
    const cents = centsOf(row.amount);
    const group = groups.get(variant.productId) ?? { productId: variant.productId, name: variant.productName, units: 0, cents: 0, variants: [], hasOptions: false };
    group.units += row.units;
    group.cents += cents;
    group.hasOptions ||= variant.values.length > 0;
    group.variants.push({ combination: variant.values.join(" / "), units: row.units, cents });
    groups.set(variant.productId, group);
  }
  return [...groups.values()];
}

const wholeCents = (sold: ProjectableSold, currency: Currency) => centsOf(sold.currencies.find((total) => total.currency === currency)?.amount ?? { amount: 0 });

function toRanked(group: Group, currency: Currency, whole: number, cap: number): RankedProduct {
  const variants = [...group.variants].sort((a, b) => b.units - a.units || b.cents - a.cents || byName(a.combination, b.combination));
  const shown = group.hasOptions ? variants.slice(0, cap) : [];
  return {
    productId: group.productId, name: group.name, units: group.units, amount: money(group.cents, currency), share: sharePercent(group.cents, whole),
    variants: shown.map((variant) => ({ combination: variant.combination, units: variant.units, amount: money(variant.cents, currency) })),
    moreVariants: group.hasOptions ? variants.length - shown.length : 0,
  };
}

/** Products sold in the store currency, ranked and paged; shares are of the whole period's product amount, never of the filtered products. */
export function rankSoldProducts(sold: ProjectableSold, described: readonly ProjectableDescribedVariant[], options: RankOptions): SoldRanking {
  const { order, page, storeCurrency } = options;
  const whole = wholeCents(sold, storeCurrency);
  const groups = groupByProduct(sold, described, storeCurrency).sort((a, b) =>
    (order === "units" ? b.units - a.units || b.cents - a.cents : b.cents - a.cents || b.units - a.units) || byName(a.name, b.name) || (a.productId < b.productId ? -1 : 1));
  const start = (page - 1) * productsPerPage;
  return {
    total: groups.length, units: groups.reduce((sum, group) => sum + group.units, 0), amount: money(groups.reduce((sum, group) => sum + group.cents, 0), storeCurrency),
    wholeAmount: money(whole, storeCurrency), page,
    items: groups.slice(start, start + productsPerPage).map((group) => toRanked(group, storeCurrency, whole, variantsPerProduct)),
  };
}

/** One product with every variant sold in the store currency and its share of the whole period; `null` when it sold nothing in that currency. */
export function rankOneProduct(sold: ProjectableSold, described: readonly ProjectableDescribedVariant[], storeCurrency: Currency): (RankedProduct & Readonly<{ wholeAmount: Money }>) | null {
  const [group] = groupByProduct(sold, described, storeCurrency);
  if (!group) return null;
  const whole = wholeCents(sold, storeCurrency);
  return { ...toRanked(group, storeCurrency, whole, Number.MAX_SAFE_INTEGER), wholeAmount: money(whole, storeCurrency) };
}

export type OtherCurrencySales = Readonly<{ currency: Currency; orders: number | null; units: number; amount: Money }>;

/**
 * What sold in each currency other than the store's, never added to the ranking. Unfiltered it is the whole currency total with its order count;
 * filtered by `texto` or `producto` it is the matching products only, and the order count of matching products cannot be known (`null`).
 */
export function otherCurrencySales(sold: ProjectableSold, described: readonly ProjectableDescribedVariant[], storeCurrency: Currency, filtered: boolean): readonly OtherCurrencySales[] {
  if (!filtered) {
    return sold.currencies.filter((total) => total.currency !== storeCurrency && total.units > 0).sort((a, b) => (a.currency < b.currency ? -1 : 1));
  }
  const matching = new Set(described.filter((variant) => variant.matchesText).map((variant) => variant.variantId));
  const totals = new Map<Currency, { units: number; cents: number }>();
  for (const row of sold.variants) {
    if (row.currency === storeCurrency || !matching.has(row.variantId)) continue;
    const total = totals.get(row.currency) ?? { units: 0, cents: 0 };
    total.units += row.units;
    total.cents += centsOf(row.amount);
    totals.set(row.currency, total);
  }
  return [...totals].map(([currency, total]): OtherCurrencySales => ({ currency, orders: null, units: total.units, amount: money(total.cents, currency) }))
    .sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

export type ProjectableStockedProduct = Readonly<{
  id: string; name: string; createdAt: Date;
  stock: Readonly<{ total: number; soldOut: number; low: number; onlyLevel: ProjectableLevel | null }>;
  variantIds: readonly string[];
}>;
export type ProjectableSaleDates = Readonly<{ variantId: string; soldInWindow: boolean; lastBefore: Date | null; firstAfter: Date | null }>;
export type UnsoldProduct = Readonly<{ product: ProjectableStockedProduct; lastBefore: Date | null; firstAfter: Date | null }>;
export type UnsoldList = Readonly<{ checked: number; total: number; page: number; items: readonly UnsoldProduct[] }>;
export type UnsoldOptions = Readonly<{ page: number; periodEndedBeforeToday: boolean }>;

/**
 * The checked products none of whose variants sold in the period, with the latest sale before it and the earliest after it folded from their variants,
 * ordered by most stock, then oldest last sale before the period (none first), then name A–Z, and paged.
 */
export function listUnsoldProducts(checked: readonly ProjectableStockedProduct[], dates: readonly ProjectableSaleDates[], options: UnsoldOptions): UnsoldList {
  const byVariant = new Map(dates.map((row) => [row.variantId, row] as const));
  const unsold: UnsoldProduct[] = [];
  for (const product of checked) {
    const rows = product.variantIds.map((id) => byVariant.get(id));
    if (rows.some((row) => row?.soldInWindow)) continue;
    const lasts = rows.flatMap((row) => (row?.lastBefore ? [row.lastBefore.getTime()] : []));
    const afters = options.periodEndedBeforeToday ? rows.flatMap((row) => (row?.firstAfter ? [row.firstAfter.getTime()] : [])) : [];
    unsold.push({ product, lastBefore: lasts.length ? new Date(Math.max(...lasts)) : null, firstAfter: afters.length ? new Date(Math.min(...afters)) : null });
  }
  unsold.sort((a, b) => b.product.stock.total - a.product.stock.total
    || (a.lastBefore?.getTime() ?? -Infinity) - (b.lastBefore?.getTime() ?? -Infinity)
    || byName(a.product.name, b.product.name) || (a.product.id < b.product.id ? -1 : 1));
  const start = (options.page - 1) * productsPerPage;
  return { checked: checked.length, total: unsold.length, page: options.page, items: unsold.slice(start, start + productsPerPage) };
}

/** Names and combinations are shortened for the agent: the text cut to `max` characters with an ellipsis. */
export const clipText = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
