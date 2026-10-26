import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductBusinessError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { OptionId, OptionText, OptionValueId, Product, ProductOption, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { combinationKey, emptiedValues, parseOptionText, productOptionLimits } from "@core/src/features/products/domain/product-structure";

type Combination = Readonly<Record<OptionId, OptionValueId>>;
export type CombinationRejection = Extract<ProductBusinessError, { code: "VARIANT_NOT_FOUND" | "PRODUCT_WITHOUT_OPTIONS" | "DUPLICATE_COMBINATION" | "VALIDATION_ERROR" }>;
export type DeletionRejection = Extract<ProductBusinessError, { code: "VARIANT_NOT_FOUND" | "VARIANT_HAS_ORDERS" | "VARIANT_HAS_STOCK" | "LAST_VARIANT" }>;

const normalize = (value: string) => value.trim().toLowerCase();
const notFound = () => ({ code: "VARIANT_NOT_FOUND" as const, message: "Variant does not exist" });

export type CombinationEntry =
  | Readonly<{ optionId: string; valueId: string }>
  | Readonly<{ optionId: string; newValue: Readonly<{ id: string; name: string }> }>;

export type CombinationPlan = Readonly<{
  variantId: VariantId;
  combinationKey: string;
  /** Only the options whose value changes. */
  changedLinks: readonly Readonly<{ optionId: OptionId; valueId: OptionValueId }>[];
  /** Appended at the end of its option. */
  newValue?: Readonly<{ id: OptionValueId; optionId: OptionId; name: OptionText }>;
  deleteValueIds: readonly OptionValueId[];
  deleteOptionIds: readonly OptionId[];
}>;

export type VariantDeletionPlan = Readonly<{ variantId: VariantId; deleteValueIds: readonly OptionValueId[]; deleteOptionIds: readonly OptionId[] }>;

/** Ids of the values the caller asks to create, so the application can look for them in other products before planning. */
export function newValueIds(entries: readonly CombinationEntry[]): readonly string[] {
  return entries.flatMap((entry) => "newValue" in entry ? [entry.newValue.id] : []);
}

function findVariant(product: Product, variantId: VariantId): ProductVariant | undefined {
  return product.variants.find((variant) => variant.id === variantId);
}

/** A `newValue` that repeats a value of the option (same id, same normalized name) is that value: a retry after an uncertain success is a no-op. */
function resolveExisting(option: ProductOption, entry: CombinationEntry): CombinationEntry {
  if (!("newValue" in entry)) return entry;
  const existing = option.values.find((value) => value.id === entry.newValue.id);
  return existing && typeof entry.newValue.name === "string" && normalize(existing.name) === normalize(entry.newValue.name)
    ? { optionId: entry.optionId, valueId: existing.id } : entry;
}

type Chosen = Readonly<{ optionId: OptionId; valueId: OptionValueId; created?: Readonly<{ id: OptionValueId; name: OptionText }> }>;

function chooseValues(product: Product, variant: ProductVariant, entries: readonly CombinationEntry[], foreignIds: ReadonlySet<string>): Readonly<{ issues: readonly ValidationIssue[]; chosen: readonly Chosen[] }> {
  const issues: ValidationIssue[] = [];
  const at = { scope: "variant" as const, variantId: variant.id, field: "values" as const };
  const byOption = new Map<string, CombinationEntry[]>();
  for (const entry of entries) byOption.set(entry.optionId, [...byOption.get(entry.optionId) ?? [], entry]);
  const optionIds = new Set<string>(product.options.map((option) => option.id));
  const wellFormed = product.options.every((option) => byOption.get(option.id)?.length === 1) && [...byOption.keys()].every((id) => optionIds.has(id));
  if (!wellFormed) return { issues: [{ ...at, reason: "INVALID_COMBINATION", message: "A variant needs exactly one value per option" }], chosen: [] };
  const known = new Set<string>(product.options.flatMap((option) => [option.id, ...option.values.map((value) => value.id)]));
  const chosen: Chosen[] = [];
  product.options.forEach((option, optionIndex) => {
    const entry = resolveExisting(option, byOption.get(option.id)![0]);
    if ("valueId" in entry) {
      if (option.values.some((value) => value.id === entry.valueId)) chosen.push({ optionId: option.id, valueId: entry.valueId as OptionValueId });
      else issues.push({ ...at, reason: "VALUE_NOT_FOUND", message: "Value does not belong to the option" });
      return;
    }
    const valueIndex = option.values.length;
    const where = { scope: "value" as const, optionIndex, valueIndex, valueId: entry.newValue.id };
    if (known.has(entry.newValue.id) || foreignIds.has(entry.newValue.id)) issues.push({ ...where, field: "id", reason: "ID_CONFLICT", message: "Identifier is already used" });
    const name = parseOptionText(entry.newValue.name);
    if (!name.success) issues.push({ ...where, field: "name", ...name.error });
    else if (option.values.some((value) => normalize(value.name) === normalize(name.data))) issues.push({ ...where, field: "name", reason: "DUPLICATE_VALUE", message: "Value is repeated" });
    if (valueIndex >= productOptionLimits.valuesPerOption) issues.push({ scope: "option", optionIndex, optionId: option.id, field: "values", reason: "TOO_MANY_VALUES", maximum: productOptionLimits.valuesPerOption, message: "Too many values" });
    if (name.success) chosen.push({ optionId: option.id, valueId: entry.newValue.id as OptionValueId, created: { id: entry.newValue.id as OptionValueId, name: name.data } });
  });
  return { issues, chosen };
}

/**
 * Moves one variant to another combination, creating at most one value. `foreignIds` are the new value ids that other
 * products of the company already use. Returns `null` when the variant already has that combination.
 */
export function planCombinationChange(product: Product, variantId: VariantId, entries: readonly CombinationEntry[], foreignIds: ReadonlySet<string>): Result<CombinationPlan | null, CombinationRejection> {
  const variant = findVariant(product, variantId);
  if (!variant) return err(notFound());
  if (!product.options.length) return err({ code: "PRODUCT_WITHOUT_OPTIONS", message: "Product has no options" });
  const { issues, chosen } = chooseValues(product, variant, entries, foreignIds);
  if (issues.length) return err({ code: "VALIDATION_ERROR", message: "Invalid combination", issues: issues as unknown as Extract<CombinationRejection, { code: "VALIDATION_ERROR" }>["issues"] });
  const combination: Combination = Object.fromEntries(chosen.map((entry) => [entry.optionId, entry.valueId]));
  const key = combinationKey(combination);
  if (key === combinationKey(variant.combination)) return ok(null);
  if (product.variants.some((other) => other.id !== variantId && combinationKey(other.combination) === key))
    return err({ code: "DUPLICATE_COMBINATION", message: "Combination is already used" });
  const created = chosen.find((entry) => entry.created);
  const options = product.options.map((option) => option.id === created?.optionId
    ? { ...option, values: [...option.values, { id: created.created!.id, name: created.created!.name }] as unknown as ProductOption["values"] } : option);
  const remaining = product.variants.map((other) => other.id === variantId ? { combination } : { combination: other.combination });
  const emptied = emptiedValues(options, remaining);
  return ok({
    variantId, combinationKey: key,
    changedLinks: chosen.filter((entry) => variant.combination[entry.optionId] !== entry.valueId).map(({ optionId, valueId }) => ({ optionId, valueId })),
    ...(created ? { newValue: { id: created.created!.id, optionId: created.optionId, name: created.created!.name } } : {}),
    deleteValueIds: [...emptied.valueIds], deleteOptionIds: [...emptied.optionIds],
  });
}

/** A variant is deleted only if no order references it, its stock is 0 and it is not the last one; values and options left empty go with it. */
export function planVariantDeletion(product: Product, variantId: VariantId, hasOrders: boolean): Result<VariantDeletionPlan, DeletionRejection> {
  const variant = findVariant(product, variantId);
  if (!variant) return err(notFound());
  if (hasOrders) return err({ code: "VARIANT_HAS_ORDERS", message: "Variant has orders" });
  if (variant.stock.quantity > 0) return err({ code: "VARIANT_HAS_STOCK", message: "Variant has stock" });
  if (product.variants.length === 1) return err({ code: "LAST_VARIANT", message: "Product needs at least one variant" });
  const emptied = emptiedValues(product.options, product.variants.filter((other) => other.id !== variantId));
  return ok({ variantId, deleteValueIds: [...emptied.valueIds], deleteOptionIds: [...emptied.optionIds] });
}
