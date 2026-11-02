import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ProductValidationReason, ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, ProductPhotos, OptionId, OptionText, OptionValueId, Product, ProductId, ProductOption, ProductOptionValue, ProductVariant, VariantId } from "@core/src/features/products/domain/product";
import { parseProductPhotos, samePhotos } from "@core/src/features/products/domain/photos";
import { createProductSchema, toValidationIssues } from "@core/src/features/products/domain/validation";

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

export type SaveVariantInput = Readonly<{ id: VariantId; sku: string | null; salePrice: number; purchasePrice: number | null }>;
export type SaveNewVariantInput = Readonly<{ values: readonly string[]; sku?: string | null; salePrice: number; purchasePrice?: number | null; initialStock?: number }>;
/** The editor's «Guardar cambios»: the complete ordered options and the variants it edits, adds or removes. */
export type SaveRequest = Readonly<{
  structureVersion: number;
  name: string;
  description: string | null;
  /** Omitted = photos untouched; present = the whole new ordered list. */
  photoIds?: readonly ImageId[];
  /** Omitted = visibility untouched; present = the value the seller wants. */
  hidden?: boolean;
  options: readonly RawOption[];
  variants: readonly SaveVariantInput[];
  newVariants: readonly SaveNewVariantInput[];
  deletedVariantIds: readonly VariantId[];
}>;

export type ProductStructureChange = Readonly<{
  productId: ProductId;
  insertOptions: readonly Readonly<{ id: OptionId; name: OptionText; position: number }>[];
  insertValues: readonly Readonly<{ id: OptionValueId; optionId: OptionId; name: OptionText; position: number }>[];
  renameOrMoveOptions: readonly Readonly<{ id: OptionId; name: OptionText; position: number }>[];
  renameOrMoveValues: readonly Readonly<{ id: OptionValueId; name: OptionText; position: number }>[];
  /** Options added to the saved variants: one link per remaining saved variant. */
  insertLinks: readonly Readonly<{ variantId: VariantId; optionId: OptionId; valueId: OptionValueId }>[];
  deleteLinksOfOptionIds: readonly OptionId[];
  deleteValueIds: readonly OptionValueId[];
  deleteOptionIds: readonly OptionId[];
  rekeyVariants: readonly Readonly<{ id: VariantId; combinationKey: string }>[];
  variantFieldChanges: readonly Readonly<{ id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null }>[];
  insertVariants: readonly Readonly<{
    id: VariantId; combination: Combination; combinationKey: string; sku?: string; salePrice: number; purchasePrice?: number; qrCode: string; initialStock: number;
  }>[];
  deleteVariantIds: readonly VariantId[];
  /** Empty when nothing changed; otherwise the changed fields, `updatedAt` and, for a structural change, the next `structureVersion`. */
  product: Readonly<{ name?: string; description?: string | null; hidden?: boolean; updatedAt?: Date; structureVersion?: number }>;
  /** The whole new photo list, only when it differs from the stored one in ids or order. A photo change never raises `structureVersion`. */
  photos?: ProductPhotos;
}>;

export function isEmptyChange(change: ProductStructureChange): boolean {
  return !Object.keys(change.product).length && change.photos === undefined
    && Object.entries(change).every(([key, list]) => key === "productId" || key === "product" || key === "photos" || !(list as readonly unknown[]).length);
}

const duplicates = <T>(items: readonly T[]): ReadonlySet<T> => new Set(items.filter((item, index) => items.indexOf(item) !== index));

/** Everything about the variants of a save that does not depend on the options: ids, orders, stock and the last variant. */
function variantIssues(current: Product, input: SaveRequest, ordered: ReadonlySet<VariantId>, remaining: number): ValidationIssue[] {
  const known = new Map(current.variants.map((variant) => [variant.id, variant] as const));
  const issues: ValidationIssue[] = [];
  const at = (variantId: string) => ({ scope: "variant" as const, variantId, field: "id" as const });
  const repeatedListed = duplicates(input.variants.map((variant) => variant.id));
  const repeatedDeleted = duplicates(input.deletedVariantIds);
  for (const id of new Set(input.variants.map((variant) => variant.id)))
    if (!known.has(id)) issues.push({ ...at(id), reason: "VARIANT_NOT_FOUND", message: "Variant does not belong to the product" });
  for (const id of repeatedListed) issues.push({ ...at(id), reason: "DUPLICATE_VARIANT", message: "Repeated variant" });
  for (const id of new Set(input.deletedVariantIds)) {
    const variant = known.get(id);
    if (!variant) issues.push({ ...at(id), reason: "VARIANT_NOT_FOUND", message: "Variant does not belong to the product" });
    else if (ordered.has(id)) issues.push({ ...at(id), reason: "VARIANT_HAS_ORDERS", message: "Variant has orders" });
    else if (variant.stock.quantity > 0) issues.push({ ...at(id), reason: "VARIANT_HAS_STOCK", message: "Variant has stock" });
  }
  for (const id of repeatedDeleted) issues.push({ ...at(id), reason: "DUPLICATE_VARIANT", message: "Repeated variant" });
  if (!remaining) issues.push({ scope: "product", field: "variants", reason: "LAST_VARIANT", message: "Product needs at least one variant" });
  return issues;
}

/** Rules that tie the requested options to the saved variants: deleted values and options, moved values and `valueForExistingVariants`. */
function optionIssues(current: Product, input: SaveRequest, remaining: readonly ProductVariant[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const savedOptions = new Map(current.options.map((option) => [option.id as string, option] as const));
  const storedOwner = new Map(current.options.flatMap((option) => option.values.map((value) => [value.id as string, option.id as string] as const)));
  input.options.forEach((option, optionIndex) => {
    const at = { optionIndex, optionId: option.id };
    const saved = savedOptions.has(option.id);
    option.values.forEach((value, valueIndex) => {
      const owner = storedOwner.get(value.id);
      if (owner !== undefined && owner !== option.id)
        issues.push({ scope: "value", optionIndex, valueIndex, valueId: value.id, field: "id", reason: "ID_CONFLICT", message: "A value never moves between options" });
    });
    const chosen = option.valueForExistingVariants;
    if (saved && chosen !== undefined) issues.push({ scope: "option", ...at, field: "valueForExistingVariants", reason: "INVALID_COMBINATION", message: "Only a new option takes a value for existing variants" });
    else if (!saved && chosen !== undefined && !option.values.some((value) => value.id === chosen))
      issues.push({ scope: "option", ...at, field: "valueForExistingVariants", reason: "INVALID_COMBINATION", message: "The value must belong to the option" });
    else if (!saved && chosen === undefined && remaining.length)
      issues.push({ scope: "option", ...at, field: "valueForExistingVariants", reason: "MISSING_VALUE_FOR_EXISTING_VARIANTS", message: "Existing variants need a value of the new option" });
  });
  const requested = new Map(input.options.map((option) => [option.id, new Set(option.values.map((value) => value.id))] as const));
  for (const variant of remaining) {
    const inUse = current.options.some((option) => {
      const values = requested.get(option.id);
      return values !== undefined && !values.has(variant.combination[option.id]);
    });
    if (inUse) issues.push({ scope: "variant", variantId: variant.id, field: "values", reason: "VALUE_IN_USE", message: "A deleted value still has variants" });
  }
  for (const option of current.options) {
    if (requested.has(option.id)) continue;
    if (new Set(remaining.map((variant) => variant.combination[option.id])).size > 1)
      issues.push({ scope: "product", field: "options", reason: "OPTION_HAS_SEVERAL_VALUES", message: "An option with several values cannot be deleted" });
  }
  if (!input.options.length && current.options.length)
    for (const variant of remaining.filter((candidate) => candidate.status !== "active"))
      issues.push({ scope: "variant", variantId: variant.id, field: "values", reason: "LAST_OPTION_VARIANT_INACTIVE", message: "The remaining variant must be active" });
  return issues;
}

/** Field rules of the name, description, SKUs and prices, reusing the create schema over saved and new rows together. */
function fieldRules(current: Product, input: SaveRequest, listed: readonly SaveVariantInput[]) {
  const result = createProductSchema.safeParse({
    name: input.name, description: input.description, currency: current.currency,
    variants: [
      ...listed.map((variant) => ({ sku: variant.sku, salePrice: variant.salePrice, purchasePrice: variant.purchasePrice })),
      ...input.newVariants.map((variant) => ({ sku: variant.sku, salePrice: variant.salePrice, purchasePrice: variant.purchasePrice, initialStock: variant.initialStock })),
    ],
  });
  const issues = result.success ? [] : toValidationIssues(result.error, { variantFallback: "values", missingVariantsReason: "REQUIRED",
    variantRef: (index) => index < listed.length ? { scope: "variant", variantId: listed[index].id } : { scope: "newVariant", index: index - listed.length } });
  return { issues, data: result.success ? result.data : undefined };
}

/**
 * The editor's save as a bounded diff of the stored product. Every issue of the request is reported together; nothing is written on rejection.
 * `ordered` holds which of the deleted variants have orders.
 */
export function planProductSave(current: Product, input: SaveRequest, ordered: ReadonlySet<VariantId>, ids: Readonly<{ newId: () => string; now: Date }>): Result<ProductStructureChange, ValidationError> {
  const deleted = new Set<string>(input.deletedVariantIds);
  const known = new Map(current.variants.map((variant) => [variant.id as string, variant] as const));
  const remaining = current.variants.filter((variant) => !deleted.has(variant.id));
  const listed = input.variants.filter((variant, index) => known.has(variant.id) && !deleted.has(variant.id) && input.variants.findIndex((other) => other.id === variant.id) === index);
  const fields = fieldRules(current, input, listed);
  const photos = input.photoIds === undefined ? undefined : parseProductPhotos(input.photoIds);

  const savedOptionIds = new Set<string>(current.options.map((option) => option.id));
  const savedRows = remaining.map((variant) => ({ values: input.options.flatMap((option) => {
    const value = savedOptionIds.has(option.id) ? variant.combination[option.id as OptionId] : option.valueForExistingVariants;
    return value === undefined ? [] : [value as string];
  }) }));
  const structure = parseProductStructure({ options: input.options, variants: [...savedRows, ...input.newVariants.map((variant) => ({ values: variant.values }))] });
  const structural = structure.issues.flatMap((issue): ValidationIssue[] => {
    if (issue.scope === "product" && issue.reason === "REQUIRED" && issue.field === "variants" && !remaining.length && !input.newVariants.length) return [];
    if (issue.scope !== "newVariant") return [issue];
    if (issue.index >= savedRows.length) return [{ ...issue, index: issue.index - savedRows.length }];
    // Saved rows are derived: only a collision with another row is the seller's to fix.
    return issue.reason === "DUPLICATE_COMBINATION" ? [{ scope: "variant", variantId: remaining[issue.index].id, field: "values", reason: issue.reason, message: issue.message }] : [];
  });

  const issues = [...fields.issues, ...photos?.success === false ? photos.error.issues : [], ...variantIssues(current, input, ordered, remaining.length + input.newVariants.length),
    ...optionIssues(current, input, remaining), ...structural];
  if (issues.length || !structure.value || !fields.data) return err({ code: "VALIDATION_ERROR", message: "Invalid product", issues: issues as unknown as ValidationError["issues"] });
  return ok(buildChange(current, input, { options: structure.value.options, combinations: structure.value.combinations, remaining, listed, data: fields.data }, ids, photos?.success ? photos.data : undefined));
}

type Built = Readonly<{
  options: readonly ProductOption[];
  combinations: readonly Combination[];
  remaining: readonly ProductVariant[];
  listed: readonly SaveVariantInput[];
  data: NonNullable<ReturnType<typeof fieldRules>["data"]>;
}>;

function buildChange(current: Product, input: SaveRequest, built: Built, ids: Readonly<{ newId: () => string; now: Date }>, photos: ProductPhotos | undefined): ProductStructureChange {
  const { options, remaining, listed, data } = built;
  const savedOptions = new Map(current.options.map((option, position) => [option.id as string, { option, position }] as const));
  const savedValues = new Map(current.options.flatMap((option) => option.values.map((value, position) => [value.id as string, { value, position }] as const)));
  const finalValueIds = new Set<string>(options.flatMap((option) => option.values.map((value) => value.id)));
  const finalOptionIds = new Set<string>(options.map((option) => option.id));

  const insertOptions = options.flatMap((option, position) => savedOptions.has(option.id) ? [] : [{ id: option.id, name: option.name, position }]);
  const insertValues = options.flatMap((option) => option.values.flatMap((value, position) => savedValues.has(value.id) ? [] : [{ id: value.id, optionId: option.id, name: value.name, position }]));
  const renameOrMoveOptions = options.flatMap((option, position) => {
    const before = savedOptions.get(option.id);
    return before && (before.option.name !== option.name || before.position !== position) ? [{ id: option.id, name: option.name, position }] : [];
  });
  const renameOrMoveValues = options.flatMap((option) => option.values.flatMap((value, position) => {
    const before = savedValues.get(value.id);
    return before && (before.value.name !== value.name || before.position !== position) ? [{ id: value.id, name: value.name, position }] : [];
  }));
  const deleteOptions = current.options.filter((option) => !finalOptionIds.has(option.id));
  const deleteValueIds = current.options.flatMap((option) => option.values.filter((value) => !finalValueIds.has(value.id)).map((value) => value.id));
  const requestedOptions = new Map(input.options.map((option) => [option.id, option] as const));
  const insertLinks = options.filter((option) => !savedOptions.has(option.id)).flatMap((option) => remaining.map((variant) => ({
    variantId: variant.id, optionId: option.id, valueId: requestedOptions.get(option.id)?.valueForExistingVariants as OptionValueId })));

  const rekeyVariants = remaining.flatMap((variant, index) => {
    const key = combinationKey(built.combinations[index]);
    return key === combinationKey(variant.combination) ? [] : [{ id: variant.id, combinationKey: key }];
  });
  const supplied = new Map(listed.map((variant, index) => [variant.id as string, data.variants[index]] as const));
  const variantFieldChanges = remaining.flatMap((variant) => {
    const next = supplied.get(variant.id);
    if (!next) return [];
    const changes: { id: VariantId; sku?: string | null; salePrice?: number; purchasePrice?: number | null } = { id: variant.id };
    if (next.sku !== variant.sku) changes.sku = next.sku ?? null;
    if (next.salePrice !== variant.salePrice.amount) changes.salePrice = next.salePrice;
    if (next.purchasePrice !== variant.purchasePrice?.amount) changes.purchasePrice = next.purchasePrice ?? null;
    return Object.keys(changes).length > 1 ? [changes] : [];
  });
  const newData = data.variants.slice(listed.length);
  const insertVariants = newData.map((variant, index) => {
    const combination = built.combinations[remaining.length + index];
    return {
      id: ids.newId() as VariantId, combination, combinationKey: combinationKey(combination), salePrice: variant.salePrice, qrCode: ids.newId(), initialStock: variant.initialStock,
      ...(variant.sku === undefined ? {} : { sku: variant.sku }),
      ...(variant.purchasePrice === undefined ? {} : { purchasePrice: variant.purchasePrice }),
    };
  });

  const deleteVariantIds = input.deletedVariantIds.filter((id, index) => current.variants.some((variant) => variant.id === id) && input.deletedVariantIds.indexOf(id) === index);
  const productFields: { name?: string; description?: string | null; hidden?: boolean } = {};
  if (data.name !== current.name) productFields.name = data.name;
  if ((data.description ?? null) !== (current.description ?? null)) productFields.description = data.description ?? null;
  if (input.hidden !== undefined && input.hidden !== current.hidden) productFields.hidden = input.hidden;
  const photosChanged = photos !== undefined && !samePhotos(photos, current.photoIds);

  const structureChanged = [insertOptions, insertValues, renameOrMoveOptions, renameOrMoveValues, insertLinks, deleteOptions, deleteValueIds, rekeyVariants, insertVariants, deleteVariantIds]
    .some((list) => list.length > 0);
  const changed = structureChanged || variantFieldChanges.length > 0 || Object.keys(productFields).length > 0 || photosChanged;
  return {
    productId: current.id, insertOptions, insertValues, renameOrMoveOptions, renameOrMoveValues, insertLinks,
    deleteLinksOfOptionIds: remaining.length ? deleteOptions.map((option) => option.id) : [],
    deleteValueIds, deleteOptionIds: deleteOptions.map((option) => option.id), rekeyVariants, variantFieldChanges, insertVariants, deleteVariantIds,
    product: changed ? { ...productFields, updatedAt: ids.now, ...(structureChanged ? { structureVersion: current.structureVersion + 1 } : {}) } : {},
    ...photosChanged ? { photos } : {},
  };
}
