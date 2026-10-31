import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { VariantStockFilter } from "@core/src/features/products/domain/stock-level";

export type MatchKey = string & { readonly __brand: "MatchKey" };

/** The one normalizer of the vocabulary: NFD, combining marks removed, lower case, trimmed. SQL never has a second one. */
export function matchKeyOf(text: string): MatchKey {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim() as MatchKey;
}

/** Integer cents of a sale price, 0..99_999_999_999 (Decimal(11, 2)). `Money.amount` is a float, so SQL compares `salePrice` with `cents / 100` exactly. */
export type PriceCents = number & { readonly __brand: "PriceCents" };
const maxPriceCents = 99_999_999_999;
export type PriceCentsError = Readonly<{ code: "NOT_AN_INTEGER" | "NEGATIVE" | "TOO_LARGE"; message: string }>;

export function parsePriceCents(cents: number): Result<PriceCents, PriceCentsError> {
  if (!Number.isSafeInteger(cents)) return err({ code: "NOT_AN_INTEGER", message: "The price must be a whole number of cents" });
  if (cents < 0) return err({ code: "NEGATIVE", message: "The price cannot be negative" });
  if (cents > maxPriceCents) return err({ code: "TOO_LARGE", message: "The price is above the stored maximum" });
  return ok(cents as PriceCents);
}

/** Plain input, as callers send it; parsed by `parseSearchCriteria`, never by the caller. */
export type SearchInput = Readonly<{
  text?: string; values?: readonly string[]; priceFromCents?: number; priceToCents?: number;
  stock?: VariantStockFilter; inCatalog?: boolean; sort: "recent" | "name"; page: number;
}>;
export type SearchCriteria = Readonly<{
  text?: string; values?: readonly [string, ...string[]]; priceFrom?: PriceCents; priceTo?: PriceCents;
  stock?: VariantStockFilter; inCatalog?: boolean; sort: "recent" | "name"; page: number;
}>;
export type SearchCriteriaError = Readonly<{ code: "INVALID_PRICE" | "PRICE_RANGE_REVERSED" | "VARIANT_FILTER_OUTSIDE_CATALOG"; message: string }>;

function parseOptionalPrice(cents: number | undefined): Result<PriceCents | undefined, SearchCriteriaError> {
  if (cents === undefined) return ok(undefined);
  const parsed = parsePriceCents(cents);
  return parsed.success ? parsed : err({ code: "INVALID_PRICE", message: parsed.error.message });
}

export function parseSearchCriteria(input: SearchInput): Result<SearchCriteria, SearchCriteriaError> {
  const from = parseOptionalPrice(input.priceFromCents);
  if (!from.success) return from;
  const to = parseOptionalPrice(input.priceToCents);
  if (!to.success) return to;
  if (from.data !== undefined && to.data !== undefined && from.data > to.data)
    return err({ code: "PRICE_RANGE_REVERSED", message: "The minimum price is above the maximum price" });
  const values = input.values?.length ? input.values as readonly [string, ...string[]] : undefined;
  if (input.inCatalog === false && (values || from.data !== undefined || to.data !== undefined || input.stock !== undefined))
    return err({ code: "VARIANT_FILTER_OUTSIDE_CATALOG", message: "Variant filters need products in the catalog" });
  return ok({
    ...input.text === undefined ? {} : { text: input.text },
    ...values ? { values } : {},
    ...from.data === undefined ? {} : { priceFrom: from.data },
    ...to.data === undefined ? {} : { priceTo: to.data },
    ...input.stock === undefined ? {} : { stock: input.stock },
    ...input.inCatalog === undefined ? {} : { inCatalog: input.inCatalog },
    sort: input.sort, page: input.page,
  });
}

/** One row per distinct (option name, value name) as written, held by an active variant. */
export type VocabularyRow = Readonly<{ optionName: string; valueName: string; productRank: number; position: number }>;
/** The written spellings that merged into one key; SQL matches them with plain equality. */
export type Spelling = Readonly<{ optionName: string; valueName: string }>;
export type StoreVocabulary = readonly Readonly<{ name: string; key: MatchKey;
  values: readonly Readonly<{ name: string; key: MatchKey; spellings: readonly Spelling[] }>[] }>[];

type Order = Readonly<{ productRank: number; position: number }>;
const byOrder = (left: Order, right: Order) => left.productRank - right.productRank || left.position - right.position;

/** Options alphabetical; values by the saved order of their first (newest) product; written form of the newest product. */
export function buildVocabulary(rows: readonly VocabularyRow[]): StoreVocabulary {
  type Entry = { first: VocabularyRow; values: Map<MatchKey, { first: VocabularyRow; spellings: Spelling[] }> };
  const options = new Map<MatchKey, Entry>();
  for (const row of [...rows].sort(byOrder)) {
    const option = options.get(matchKeyOf(row.optionName)) ?? { first: row, values: new Map() } as Entry;
    options.set(matchKeyOf(row.optionName), option);
    const value = option.values.get(matchKeyOf(row.valueName)) ?? { first: row, spellings: [] };
    option.values.set(matchKeyOf(row.valueName), value);
    if (!value.spellings.some((spelling) => spelling.optionName === row.optionName && spelling.valueName === row.valueName))
      value.spellings.push({ optionName: row.optionName, valueName: row.valueName });
  }
  return [...options].map(([key, option]) => ({
    name: option.first.optionName, key,
    values: [...option.values].map(([valueKey, value]) => ({ name: value.first.valueName, key: valueKey, spellings: value.spellings })),
  })).sort((left, right) => left.name.localeCompare(right.name, "es"));
}

export type ValueRejection =
  | Readonly<{ kind: "no_options" }>
  | Readonly<{ kind: "unknown_value"; written: string; vocabulary: StoreVocabulary }>
  | Readonly<{ kind: "value_in_other_option"; written: string; option: string; vocabulary: StoreVocabulary }>
  | Readonly<{ kind: "unknown_option"; option: string; vocabulary: StoreVocabulary }>;

function resolveEntry(entry: string, vocabulary: StoreVocabulary): readonly Spelling[] | ValueRejection {
  const colon = entry.indexOf(":");
  const left = colon < 0 ? "" : entry.slice(0, colon).trim();
  const option = left ? vocabulary.find(({ key }) => key === matchKeyOf(left)) : undefined;
  if (colon >= 0 && option) {
    const written = entry.slice(colon + 1).trim();
    const value = option.values.find(({ key }) => key === matchKeyOf(written));
    if (value) return value.spellings;
    const elsewhere = vocabulary.some(({ values }) => values.some(({ key }) => key === matchKeyOf(written)));
    return elsewhere ? { kind: "value_in_other_option", written, option: option.name, vocabulary } : { kind: "unknown_value", written, vocabulary };
  }
  const spellings = vocabulary.flatMap(({ values }) => values.filter(({ key }) => key === matchKeyOf(entry)).flatMap((value) => value.spellings));
  if (spellings.length) return spellings;
  const right = colon < 0 ? "" : entry.slice(colon + 1).trim();
  return left && right ? { kind: "unknown_option", option: left, vocabulary } : { kind: "unknown_value", written: entry.trim(), vocabulary };
}

/** One spelling set per entry, in entry order; the first entry that fails decides. */
export function resolveValues(entries: readonly string[], vocabulary: StoreVocabulary): Result<readonly (readonly Spelling[])[], ValueRejection & { message: string }> {
  if (!vocabulary.length) return err({ kind: "no_options", message: "No product of the store has options" });
  const sets: (readonly Spelling[])[] = [];
  for (const entry of entries) {
    const resolved = resolveEntry(entry, vocabulary);
    if (!Array.isArray(resolved)) return err({ ...(resolved as ValueRejection), message: "Value not found in the store's vocabulary" });
    sets.push(resolved);
  }
  return ok(sets);
}
