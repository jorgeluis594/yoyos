import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductValidationReason, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { OptionId, OptionText, OptionValueId, Product, ProductOption, ProductOptionValue, ProductVariant } from "@core/src/features/products/domain/product";

/** The domain owns the limits; shared/contracts/products.ts repeats them for the editors and a test keeps both equal. */
export const productOptionLimits = { options: 3, valuesPerOption: 30, variants: 100, nameLength: 30 } as const;
const normalizeOptionText = (value: string) => value.trim().toLowerCase();

type Combination = Readonly<Record<OptionId, OptionValueId>>;
type IssueDraft = ProductValidationReason & { readonly message: string };

/** Value ids as lowercase text, sorted by code unit (the "C" collation in SQL) and joined by ",". Empty without options. */
export function combinationKey(combination: Combination): string {
  return Object.values(combination).map((valueId) => valueId.toLowerCase()).sort().join(",");
}

function valuePositions(product: Product): ReadonlyMap<OptionValueId, number> {
  return new Map(product.options.flatMap((option) => option.values.map((value, position) => [value.id, position] as const)));
}

/** Variants by option positions and then value positions, so combinations read as the seller ordered them. */
export function sortVariants(product: Product): Product["variants"] {
  const positions = valuePositions(product);
  const rank = (variant: ProductVariant) => product.options.map((option) => positions.get(variant.combination[option.id] as OptionValueId) ?? Number.MAX_SAFE_INTEGER);
  const sorted = [...product.variants].sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    for (let index = 0; index < leftRank.length; index += 1) if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return sorted as unknown as Product["variants"];
}

/** Option name to value name, with keys inserted in saved option order. */
export function orderedAttributes(product: Product, variant: ProductVariant): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  for (const option of product.options) {
    const value = option.values.find((candidate) => candidate.id === variant.combination[option.id]);
    if (value) attributes[option.name] = value.name;
  }
  return attributes;
}

const codePoints = (value: string) => [...value].length;

/** Trimmed option or value name of 1..30 code points. */
export function parseOptionText(raw: unknown): Result<OptionText, IssueDraft> {
  if (typeof raw !== "string") return err({ reason: "INVALID_TYPE", message: "Name must be text" });
  const value = raw.trim();
  if (!value) return err({ reason: "REQUIRED", message: "Name is required" });
  if (codePoints(value) > productOptionLimits.nameLength) return err({ reason: "TOO_LONG", maxLength: productOptionLimits.nameLength, message: "Name exceeds maximum length" });
  return ok(value as OptionText);
}

export type RawOptionValue = Readonly<{ id: string; name: string }>;
export type RawOption = Readonly<{ id: string; name: string; values: readonly RawOptionValue[]; valueForExistingVariants?: string }>;
export type RawStructure = Readonly<{ options: readonly RawOption[]; variants: readonly Readonly<{ values: readonly string[] }>[] }>;
export type ParsedStructure = Readonly<{ options: readonly ProductOption[]; combinations: readonly Combination[] }>;

/** Indexes that share a non-empty normalized key with another entry. */
function repeated(keys: readonly (string | null)[]): ReadonlySet<number> {
  const groups = new Map<string, number[]>();
  keys.forEach((key, index) => { if (key) groups.set(key, [...groups.get(key) ?? [], index]); });
  return new Set([...groups.values()].filter((group) => group.length > 1).flat());
}

const nameKey = (name: unknown) => typeof name === "string" ? normalizeOptionText(name) : null;

/** Values and options that no remaining variant uses: the product rule «Valor sin variantes». */
export function emptiedValues(options: readonly ProductOption[], variants: readonly Readonly<{ combination: Combination }>[]): Readonly<{ valueIds: ReadonlySet<OptionValueId>; optionIds: ReadonlySet<OptionId> }> {
  const used = new Set<OptionValueId>(variants.flatMap((variant) => Object.values(variant.combination)));
  const valueIds = new Set<OptionValueId>(options.flatMap((option) => option.values.filter((value) => !used.has(value.id)).map((value) => value.id)));
  const optionIds = new Set<OptionId>(options.filter((option) => option.values.every((value) => valueIds.has(value.id))).map((option) => option.id));
  return { valueIds, optionIds };
}

/** The options without the emptied values, and without the options left empty. */
export function withoutEmptied(options: readonly ProductOption[], emptied: ReturnType<typeof emptiedValues>): readonly ProductOption[] {
  return options.filter((option) => !emptied.optionIds.has(option.id)).map((option) => ({
    ...option, values: option.values.filter((value) => !emptied.valueIds.has(value.id)) as unknown as ProductOption["values"],
  }));
}

/**
 * Structural rules of a new product: limits, names, ids, one value per option in every variant and distinct combinations.
 * Every issue is reported together. On success, values without variants and options left without values are dropped.
 */
export function parseProductStructure(input: RawStructure): Readonly<{ issues: readonly ValidationIssue[]; value?: ParsedStructure }> {
  const issues: ValidationIssue[] = [];
  const { options, variants } = input;
  if (options.length > productOptionLimits.options) issues.push({ scope: "product", field: "options", reason: "TOO_MANY_OPTIONS", maximum: productOptionLimits.options, message: "Too many options" });
  const ids = new Set<string>();
  const parsedOptions: ProductOption[] = [];
  options.forEach((option, optionIndex) => {
    const at = { optionIndex, optionId: option.id };
    if (ids.has(option.id)) issues.push({ scope: "option", ...at, field: "id", reason: "ID_CONFLICT", message: "Identifier is repeated" });
    ids.add(option.id);
    const name = parseOptionText(option.name);
    if (!name.success) issues.push({ scope: "option", ...at, field: "name", ...name.error });
    if (!option.values.length) issues.push({ scope: "option", ...at, field: "values", reason: "OPTION_WITHOUT_VALUES", message: "Option needs at least one value" });
    if (option.values.length > productOptionLimits.valuesPerOption) issues.push({ scope: "option", ...at, field: "values", reason: "TOO_MANY_VALUES", maximum: productOptionLimits.valuesPerOption, message: "Too many values" });
    const values: ProductOptionValue[] = [];
    option.values.forEach((value, valueIndex) => {
      const valueAt = { optionIndex, valueIndex, valueId: value.id };
      if (ids.has(value.id)) issues.push({ scope: "value", ...valueAt, field: "id", reason: "ID_CONFLICT", message: "Identifier is repeated" });
      ids.add(value.id);
      const valueName = parseOptionText(value.name);
      if (!valueName.success) issues.push({ scope: "value", ...valueAt, field: "name", ...valueName.error });
      else values.push({ id: value.id as OptionValueId, name: valueName.data });
    });
    for (const valueIndex of repeated(option.values.map((value) => nameKey(value.name))))
      issues.push({ scope: "value", optionIndex, valueIndex, valueId: option.values[valueIndex].id, field: "name", reason: "DUPLICATE_VALUE", message: "Value is repeated" });
    if (name.success && values.length && values.length === option.values.length) parsedOptions.push({ id: option.id as OptionId, name: name.data, values: values as unknown as ProductOption["values"] });
  });
  for (const optionIndex of repeated(options.map((option) => nameKey(option.name))))
    issues.push({ scope: "option", optionIndex, optionId: options[optionIndex].id, field: "name", reason: "DUPLICATE_OPTION", message: "Option is repeated" });

  if (!variants.length) issues.push({ scope: "product", field: "variants", reason: "REQUIRED", message: "At least one variant is required" });
  if (variants.length > productOptionLimits.variants) issues.push({ scope: "product", field: "variants", reason: "TOO_MANY_VARIANTS", maximum: productOptionLimits.variants, message: "Too many variants" });
  const ownerOf = new Map<string, number>();
  options.forEach((option, optionIndex) => option.values.forEach((value) => { if (!ownerOf.has(value.id)) ownerOf.set(value.id, optionIndex); }));
  const combinations: (Combination | null)[] = variants.map((variant, index) => {
    const chosen = new Map<number, string>();
    let unknown = false;
    let invalid = false;
    for (const valueId of variant.values) {
      const owner = ownerOf.get(valueId);
      if (owner === undefined) unknown = true;
      else if (chosen.has(owner)) invalid = true;
      else chosen.set(owner, valueId);
    }
    if (unknown) issues.push({ scope: "newVariant", index, field: "values", reason: "VALUE_NOT_FOUND", message: "Value does not belong to the product" });
    else if (invalid || chosen.size !== options.length) issues.push({ scope: "newVariant", index, field: "values", reason: "INVALID_COMBINATION", message: "A variant needs exactly one value per option" });
    if (unknown || invalid || chosen.size !== options.length) return null;
    return Object.fromEntries(options.map((option, optionIndex) => [option.id, chosen.get(optionIndex)])) as Combination;
  });
  for (const index of repeated(combinations.map((combination) => combination && (combinationKey(combination) || "-"))))
    issues.push({ scope: "newVariant", index, field: "values", reason: "DUPLICATE_COMBINATION", message: "Combination is repeated" });

  if (issues.length) return { issues };
  const valid = combinations as Combination[];
  const final = withoutEmptied(parsedOptions, emptiedValues(parsedOptions, valid.map((combination) => ({ combination }))));
  return { issues, value: { options: final, combinations: valid } };
}
