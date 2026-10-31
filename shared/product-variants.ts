/** Rules shared by the editors on web and mobile. Advisory: core validates everything again. */

import { productOptionLimits } from "@shared/contracts/products";
import { err, ok } from "@shared/functional";
import type { AppError, Result } from "@shared/result";
import type { CreateProductRequest, ProductDetailResponse, SaveProductRequest } from "@shared/contracts/products";
import type { VisibilityToSave } from "@shared/product-visibility";
import type { PhotosToSave } from "@shared/product-photos";

type LabelOption = Readonly<{ id: string; values: readonly Readonly<{ id: string; name: string }>[] }>;
type LabelCombination = readonly Readonly<{ optionId: string; valueId: string }>[] | Readonly<Record<string, string>>;

/** «L / Azul»: the variant's value names in saved option order. Empty for a product without options. */
export function combinationLabel(options: readonly LabelOption[], combination: LabelCombination): string {
  const valueOf = new Map(Array.isArray(combination)
    ? combination.map((entry) => [entry.optionId, entry.valueId] as const)
    : Object.entries(combination));
  return options
    .flatMap((option) => option.values.find((value) => value.id === valueOf.get(option.id))?.name ?? [])
    .join(" / ");
}

// Editor draft. Rows are identified by `ref` and by value ids, never by text, so renames, reorders and added options keep what was edited.

export type EditorBase = Readonly<{ sku: string | null; salePrice: number; purchasePrice: number | null; stock: number }>;
export type EditorValue = Readonly<{ id: string; name: string; saved: boolean; marked: boolean }>;
export type EditorOption = Readonly<{
  id: string; name: string; saved: boolean; marked: boolean; values: readonly EditorValue[];
  /** Only for an option added to a saved product: the value its existing variants receive. */
  valueForExistingVariants: string | null;
}>;
export type EditorRow = Readonly<{
  ref: string;
  /** The saved variant id; null for a combination that is not saved yet. */
  id: string | null;
  combination: Readonly<Record<string, string>>;
  sku: string | null; salePrice: number; purchasePrice: number | null; stock: number;
  status: "active" | "inactive";
  hasOrders: boolean;
  marked: boolean;
  /** A new combination whose prices come from an inactive variant. It is created active. */
  copiedFromInactive: boolean;
  original: Readonly<{ sku: string | null; salePrice: number; purchasePrice: number | null }> | null;
}>;
export type EditorDraft = Readonly<{
  saved: boolean; base: EditorBase; options: readonly EditorOption[]; rows: readonly EditorRow[]; nextRef: number; stockNotice: boolean;
}>;

export type EditFailureReason =
  | "TOO_MANY_OPTIONS" | "TOO_MANY_VALUES" | "TOO_MANY_VARIANTS" | "OPTION_WITHOUT_VALUES" | "OPTION_NOT_FOUND" | "VALUE_NOT_FOUND" | "ROW_NOT_FOUND" | "OPTION_NOT_NEW" | "DUPLICATE_COMBINATION"
  | "VARIANT_HAS_ORDERS_OR_STOCK" | "OPTION_HAS_SEVERAL_VALUES" | "LAST_OPTION_VARIANT_INACTIVE"
  | "DUPLICATE_ID" | "VALUE_FOR_EXISTING_VARIANTS" | "SAVED_VARIANT";
export type EditFailure = AppError & Readonly<{ code: EditFailureReason; projected?: number; maximum?: number; blocked?: number }>;
export type Edit = Result<EditorDraft, EditFailure>;
export type RowRemoval = "self" | "value" | "option";
export type RowPatch = Partial<Readonly<{ sku: string | null; salePrice: number; purchasePrice: number | null; stock: number }>>;
export type Uncreated = Readonly<{ items: readonly Readonly<{ combination: Readonly<Record<string, string>>; label: string }>[]; hasMore: boolean }>;
export type ProductMeta = Readonly<{ name: string; description: string | null; photos: PhotosToSave }>;

const { options: maxOptions, valuesPerOption: maxValues, variants: maxVariants } = productOptionLimits;
const uncreatedPageSize = 50;

const fail = (reason: EditFailureReason, extra: Partial<EditFailure> = {}): Edit => err({ message: reason, code: reason, ...extra });
const done = (draft: EditorDraft): Edit => ok(draft);

export function createDraft(base: EditorBase): EditorDraft {
  return { saved: false, base, options: [], rows: [], nextRef: 1, stockNotice: false };
}

export function draftFromProduct(product: ProductDetailResponse["product"]): EditorDraft {
  const first = product.variants[0];
  return {
    saved: true,
    base: { sku: first.sku, salePrice: first.salePrice.amount, purchasePrice: first.purchasePrice?.amount ?? null, stock: 0 },
    options: product.options.map((option) => ({
      id: option.id, name: option.name, saved: true, marked: false, valueForExistingVariants: null,
      values: option.values.map((value) => ({ id: value.id, name: value.name, saved: true, marked: false })),
    })),
    rows: product.variants.map((variant) => ({
      ref: variant.id, id: variant.id, combination: Object.fromEntries(variant.combination.map((entry) => [entry.optionId, entry.valueId])),
      sku: variant.sku, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null, stock: variant.stock,
      status: variant.status === "active" ? "active" : "inactive", hasOrders: variant.hasOrders, marked: false, copiedFromInactive: false,
      original: { sku: variant.sku, salePrice: variant.salePrice.amount, purchasePrice: variant.purchasePrice?.amount ?? null },
    })),
    nextRef: 1,
    stockNotice: false,
  };
}

/** Back to a product without options, with the values the form had before the first option. */
export const clearOptions = (draft: EditorDraft): EditorDraft => createDraft(draft.base);

// Derived state

const liveValues = (option: EditorOption) => option.values.filter((value) => !value.marked);
const liveOptions = (draft: EditorDraft) => draft.options.filter((option) => !option.marked);

/** The value a removed option leaves behind in the rows that survive. */
function keptValueId(option: EditorOption): string | null {
  const live = liveValues(option);
  return live.find((value) => value.id === option.valueForExistingVariants)?.id ?? live[0]?.id ?? null;
}

export function removalOf(draft: EditorDraft, row: EditorRow): RowRemoval | null {
  if (draft.options.some((option) => option.values.some((value) => value.marked && value.id === row.combination[option.id]))) return "value";
  if (draft.options.some((option) => option.marked && row.combination[option.id] !== keptValueId(option))) return "option";
  return row.marked ? "self" : null;
}

const liveRows = (draft: EditorDraft) => orderedRows(draft).filter((row) => removalOf(draft, row) === null);

export function orderedRows(draft: EditorDraft): readonly EditorRow[] {
  const position = (row: EditorRow) => [
    draft.saved && row.id === null ? 1 : 0,
    ...draft.options.map((option) => option.values.findIndex((value) => value.id === row.combination[option.id])),
  ];
  return [...draft.rows].sort((a, b) => {
    const [left, right] = [position(a), position(b)];
    const at = left.findIndex((part, index) => part !== right[index]);
    return at === -1 ? 0 : left[at] - right[at];
  });
}

export const rowLabel = (draft: EditorDraft, row: EditorRow): string => combinationLabel(draft.options, row.combination);

export function variantCounter(draft: EditorDraft): Readonly<{ count: number; inactive: number; maximum: number }> {
  const live = liveRows(draft);
  return { count: live.length, inactive: live.filter((row) => row.status === "inactive").length, maximum: maxVariants };
}

/** Stock copied from the base to generated combinations; null once the seller edits stock or saves. */
export function copiedStockNotice(draft: EditorDraft): number | null {
  return draft.stockNotice && !draft.saved && draft.base.stock > 0 && liveRows(draft).length > 0 ? draft.base.stock : null;
}

export const inactiveSourceCount = (draft: EditorDraft): number => liveRows(draft).filter((row) => row.id === null && row.copiedFromInactive).length;

// Adding

type Source = Readonly<{ salePrice: number; purchasePrice: number | null; inactive: boolean }>;

/** The first variant, preferring an active one, among those that share the combination's other values. */
function sourceFor(draft: EditorDraft, combination: Readonly<Record<string, string>>, except?: string): Source {
  const rows = liveRows(draft);
  const shared = (row: EditorRow) => draft.options.filter((option) => option.id !== except && row.combination[option.id] === combination[option.id]).length;
  const best = Math.max(0, ...rows.map(shared));
  const candidates = rows.filter((row) => shared(row) === best);
  const picked = candidates.find((row) => row.status === "active") ?? candidates[0] ?? rows[0];
  if (!picked) return { salePrice: draft.base.salePrice, purchasePrice: draft.base.purchasePrice, inactive: false };
  return { salePrice: picked.salePrice, purchasePrice: picked.purchasePrice, inactive: picked.status === "inactive" || picked.copiedFromInactive };
}

function newRow(draft: EditorDraft, ref: number, combination: Readonly<Record<string, string>>, source: Source): EditorRow {
  return {
    ref: `new-${ref}`, id: null, combination, sku: null, salePrice: source.salePrice, purchasePrice: source.purchasePrice,
    stock: draft.saved ? 0 : draft.base.stock, status: "active", hasOrders: false, marked: false, copiedFromInactive: source.inactive, original: null,
  };
}

/** Combinations of the given option value lists, first option slowest, produced lazily. */
function* combinations(lists: readonly (readonly [string, readonly string[]])[]): Generator<Record<string, string>> {
  if (lists.some(([, values]) => values.length === 0)) return;
  const counters = lists.map(() => 0);
  while (true) {
    yield Object.fromEntries(lists.map(([optionId, values], index) => [optionId, values[counters[index]]]));
    let at = lists.length - 1;
    while (at >= 0 && ++counters[at] === lists[at][1].length) counters[at--] = 0;
    if (at < 0) return;
  }
}

const withRows = (draft: EditorDraft, rows: readonly EditorRow[], added: number, extra: Partial<EditorDraft> = {}): EditorDraft =>
  ({ ...draft, rows, nextRef: draft.nextRef + added, ...extra });

/** Option and value ids share one namespace: core rejects an id used as both. */
const idsOf = (draft: EditorDraft) => new Set(draft.options.flatMap((option) => [option.id, ...option.values.map((value) => value.id)]));

export function addOption(
  draft: EditorDraft,
  input: Readonly<{ id: string; name: string; values: readonly Readonly<{ id: string; name: string }>[]; valueForExistingVariants?: string }>,
): Edit {
  if (input.values.length === 0) return fail("OPTION_WITHOUT_VALUES");
  const taken = idsOf(draft);
  const inputIds = [input.id, ...input.values.map((value) => value.id)];
  if (new Set(inputIds).size !== inputIds.length || inputIds.some((id) => taken.has(id))) return fail("DUPLICATE_ID");
  if (draft.options.length >= maxOptions) return fail("TOO_MANY_OPTIONS", { maximum: maxOptions });
  if (input.values.length > maxValues) return fail("TOO_MANY_VALUES", { maximum: maxValues });
  const chosen = input.values.find((value) => value.id === input.valueForExistingVariants) ?? input.values[0];
  const option: EditorOption = {
    id: input.id, name: input.name, saved: false, marked: false, valueForExistingVariants: draft.saved ? chosen.id : null,
    values: input.values.map((value) => ({ id: value.id, name: value.name, saved: false, marked: false })),
  };
  const live = liveRows(draft);
  const generating = draft.rows.length === 0 && !draft.saved;
  const projected = generating ? input.values.length : live.length * input.values.length;
  if (projected > maxVariants) return fail("TOO_MANY_VARIANTS", { projected, maximum: maxVariants });
  const options = [...draft.options, option];
  const next = { ...draft, options };
  if (generating) {
    const source: Source = { salePrice: draft.base.salePrice, purchasePrice: draft.base.purchasePrice, inactive: false };
    const rows = input.values.map((value, index) => newRow(draft, draft.nextRef + index, { [option.id]: value.id }, source));
    return done(withRows(next, rows, rows.length, { stockNotice: true }));
  }
  const gained = draft.rows.map((row) => ({ ...row, combination: { ...row.combination, [option.id]: chosen.id } }));
  let ref = draft.nextRef;
  const copies = live.flatMap((row) => input.values.filter((value) => value.id !== chosen.id).map((value) => {
    const source: Source = { salePrice: row.salePrice, purchasePrice: row.purchasePrice, inactive: row.status === "inactive" || row.copiedFromInactive };
    return newRow(draft, ref++, { ...row.combination, [option.id]: value.id }, source);
  }));
  return done(withRows(next, [...gained, ...copies], copies.length));
}

/**
 * Changes the value that the saved variants receive from an option added to a saved product. The saved rows and the copies
 * trade values, so refs, edits and the inactive-source flag stay with their rows.
 */
export function setValueForExistingVariants(draft: EditorDraft, optionId: string, valueId: string): Edit {
  const option = draft.options.find((candidate) => candidate.id === optionId);
  const current = option && keptValueId(option);
  if (!option) return fail("OPTION_NOT_FOUND");
  if (option.saved || !draft.saved || !current) return fail("OPTION_NOT_NEW");
  if (!liveValues(option).some((value) => value.id === valueId)) return fail("VALUE_NOT_FOUND");
  const swap = (id: string | undefined) => id === current ? valueId : id === valueId ? current : id;
  // A removal mark belongs to the combination, not to the row: each row takes the mark of the new row that held its new combination before the swap.
  // A saved variant cannot carry one, so a mark that lands on it is dropped.
  const combinationKey = (combination: Readonly<Record<string, string>>) => draft.options.map((candidate) => combination[candidate.id]).join(",");
  const markedBefore = new Set(draft.rows.filter((row) => row.id === null && row.marked).map((row) => combinationKey(row.combination)));
  const rows = draft.rows.map((row) => {
    const combination = { ...row.combination, [optionId]: swap(row.combination[optionId]) as string };
    return { ...row, combination, marked: row.id === null && markedBefore.has(combinationKey(combination)) };
  });
  return done({ ...mapOption(draft, optionId, (candidate) => ({ ...candidate, valueForExistingVariants: valueId })), rows });
}

export function addValue(draft: EditorDraft, optionId: string, value: Readonly<{ id: string; name: string }>): Edit {
  const target = draft.options.find((option) => option.id === optionId);
  if (!target) return fail("OPTION_NOT_FOUND");
  if (target.values.length >= maxValues) return fail("TOO_MANY_VALUES", { maximum: maxValues });
  if (idsOf(draft).has(value.id)) return fail("DUPLICATE_ID");
  const others = liveOptions(draft).filter((option) => option.id !== optionId);
  const created = others.reduce((product, option) => product * liveValues(option).length, 1);
  const projected = liveRows(draft).length + created;
  if (projected > maxVariants) return fail("TOO_MANY_VARIANTS", { projected, maximum: maxVariants });
  const options = draft.options.map((option) => option.id === optionId
    ? { ...option, values: [...option.values, { id: value.id, name: value.name, saved: false, marked: false }] }
    : option);
  const fixed = Object.fromEntries(draft.options.filter((option) => option.marked && option.id !== optionId).map((option) => [option.id, keptValueId(option) ?? ""]));
  let ref = draft.nextRef;
  const rows = [...combinations(others.map((option) => [option.id, liveValues(option).map((other) => other.id)] as const))].map((combination) => {
    const full = { ...fixed, ...combination, [optionId]: value.id };
    return newRow(draft, ref++, full, sourceFor(draft, full, optionId));
  });
  return done(withRows({ ...draft, options }, [...draft.rows, ...rows], rows.length));
}

const keyOf = (draft: EditorDraft, combination: Readonly<Record<string, string>>) => liveOptions(draft).map((option) => combination[option.id]).join(",");

/** Combinations the options allow that have no live row. Uses the product of the value counts, never an enumeration. */
export function uncreatedCount(draft: EditorDraft): number {
  const options = liveOptions(draft);
  if (options.length === 0) return 0;
  return Math.max(0, options.reduce((product, option) => product * liveValues(option).length, 1) - liveRows(draft).length);
}

/** Uncreated combinations in saved order, produced lazily so a page costs only what it skips and returns. */
export function uncreatedCombinations(draft: EditorDraft, page: Readonly<{ offset?: number; limit?: number }> = {}): Uncreated {
  const { offset = 0, limit = uncreatedPageSize } = page;
  const options = liveOptions(draft);
  if (options.length === 0) return { items: [], hasMore: false };
  const taken = new Set(liveRows(draft).map((row) => keyOf(draft, row.combination)));
  const fixed = Object.fromEntries(draft.options.filter((option) => option.marked).map((option) => [option.id, keptValueId(option) ?? ""]));
  const items: { combination: Record<string, string>; label: string }[] = [];
  let skipped = 0;
  for (const combination of combinations(options.map((option) => [option.id, liveValues(option).map((value) => value.id)] as const))) {
    if (taken.has(keyOf(draft, combination))) continue;
    if (skipped < offset) { skipped++; continue; }
    if (items.length === limit) return { items, hasMore: true };
    const full = { ...fixed, ...combination };
    items.push({ combination: full, label: combinationLabel(options, full) });
  }
  return { items, hasMore: false };
}

export function addCombination(draft: EditorDraft, combination: Readonly<Record<string, string>>): Edit {
  if (liveRows(draft).some((row) => keyOf(draft, row.combination) === keyOf(draft, combination))) return fail("DUPLICATE_COMBINATION");
  const projected = liveRows(draft).length + 1;
  if (projected > maxVariants) return fail("TOO_MANY_VARIANTS", { projected, maximum: maxVariants });
  return done(withRows(draft, [...draft.rows, newRow(draft, draft.nextRef, combination, sourceFor(draft, combination))], 1));
}

// Renaming, moving and editing

const mapOption = (draft: EditorDraft, optionId: string, change: (option: EditorOption) => EditorOption): EditorDraft =>
  ({ ...draft, options: draft.options.map((option) => option.id === optionId ? change(option) : option) });
const moved = <T>(items: readonly T[], from: number, to: number): readonly T[] => {
  if (from < 0) return items;
  const rest = items.filter((_, index) => index !== from);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, items[from]);
  return rest;
};

export const renameOption = (draft: EditorDraft, optionId: string, name: string): EditorDraft => mapOption(draft, optionId, (option) => ({ ...option, name }));
export const renameValue = (draft: EditorDraft, valueId: string, name: string): EditorDraft =>
  ({ ...draft, options: draft.options.map((option) => ({ ...option, values: option.values.map((value) => value.id === valueId ? { ...value, name } : value) })) });
export const moveOption = (draft: EditorDraft, optionId: string, to: number): EditorDraft =>
  ({ ...draft, options: moved(draft.options, draft.options.findIndex((option) => option.id === optionId), to) });
export const moveValue = (draft: EditorDraft, optionId: string, valueId: string, to: number): EditorDraft =>
  mapOption(draft, optionId, (option) => ({ ...option, values: moved(option.values, option.values.findIndex((value) => value.id === valueId), to) }));

const mapRows = (draft: EditorDraft, change: (row: EditorRow) => EditorRow, only?: ReadonlySet<string>): EditorDraft =>
  ({ ...draft, rows: draft.rows.map((row) => !only || only.has(row.ref) ? change(row) : row) });

/** Stock belongs to new rows only: saved variants keep theirs. */
const patched = (row: EditorRow, patch: RowPatch): EditorRow => {
  const { stock, ...rest } = patch;
  return { ...row, ...rest, ...(stock !== undefined && row.id === null ? { stock } : {}) };
};

export function setRow(draft: EditorDraft, ref: string, patch: RowPatch): EditorDraft {
  const next = mapRows(draft, (row) => patched(row, patch), new Set([ref]));
  return patch.stock !== undefined && draft.rows.some((row) => row.ref === ref && row.id === null) ? { ...next, stockNotice: false } : next;
}

/** Applies to the live selected rows. Stock reaches new rows only, and `applied` counts the rows that changed. */
export function applyBulk(draft: EditorDraft, selected: readonly string[], patch: RowPatch): Readonly<{ draft: EditorDraft; applied: number }> {
  const live = new Set(liveRows(draft).filter((row) => selected.includes(row.ref) && (patch.stock === undefined || row.id === null)).map((row) => row.ref));
  const next = mapRows(draft, (row) => patched(row, patch), live);
  return { draft: patch.stock !== undefined && live.size > 0 ? { ...next, stockNotice: false } : next, applied: live.size };
}

// Removing: nothing disappears before saving, it is marked and can be undone

/** Only a combination that is not saved yet can be marked: a saved variant is deleted from its own screen or through its value. */
export function removeRow(draft: EditorDraft, ref: string): Edit {
  const row = draft.rows.find((candidate) => candidate.ref === ref);
  if (!row) return fail("ROW_NOT_FOUND");
  if (row.id !== null) return fail("SAVED_VARIANT");
  return done(mapRows(draft, (candidate) => ({ ...candidate, marked: true }), new Set([ref])));
}
export const undoRemoveRow = (draft: EditorDraft, ref: string): EditorDraft => mapRows(draft, (row) => ({ ...row, marked: false }), new Set([ref]));

const markValue = (draft: EditorDraft, valueId: string, marked: boolean): EditorDraft =>
  ({ ...draft, options: draft.options.map((option) => ({ ...option, values: option.values.map((value) => value.id === valueId ? { ...value, marked } : value) })) });

export function removeValue(draft: EditorDraft, valueId: string): Edit {
  const option = draft.options.find((candidate) => candidate.values.some((value) => value.id === valueId));
  if (!option) return fail("VALUE_NOT_FOUND");
  const blocked = draft.rows.filter((row) => row.id !== null && row.combination[option.id] === valueId && (row.hasOrders || row.stock > 0)).length;
  if (draft.saved && !option.saved && keptValueId(option) === valueId) return fail("VALUE_FOR_EXISTING_VARIANTS");
  if (option.values.find((value) => value.id === valueId)?.saved && blocked > 0) return fail("VARIANT_HAS_ORDERS_OR_STOCK", { blocked });
  return done(markValue(draft, valueId, true));
}
export const undoRemoveValue = (draft: EditorDraft, valueId: string): EditorDraft => markValue(draft, valueId, false);

export function removeOption(draft: EditorDraft, optionId: string): Edit {
  const option = draft.options.find((candidate) => candidate.id === optionId);
  if (!option) return fail("OPTION_NOT_FOUND");
  if (option.saved && liveValues(option).length > 1) return fail("OPTION_HAS_SEVERAL_VALUES");
  const remaining = liveOptions(draft).filter((candidate) => candidate.id !== optionId);
  if (draft.saved && remaining.length === 0 && liveRows(draft).some((row) => row.id !== null && row.status === "inactive")) return fail("LAST_OPTION_VARIANT_INACTIVE");
  return done(mapOption(draft, optionId, (candidate) => ({ ...candidate, marked: true })));
}
export const undoRemoveOption = (draft: EditorDraft, optionId: string): EditorDraft => mapOption(draft, optionId, (option) => ({ ...option, marked: false }));

// Bulk selection by chips

const hasValue = (row: EditorRow, valueId: string) => Object.values(row.combination).includes(valueId);
const selectable = (draft: EditorDraft, filter: string | null) =>
  liveRows(draft).filter((row) => row.status === "active" && (filter === null || hasValue(row, filter)));
const toggled = (selected: readonly string[], targets: readonly EditorRow[]): readonly string[] => {
  const refs = targets.map((row) => row.ref);
  return refs.length > 0 && refs.every((ref) => selected.includes(ref))
    ? selected.filter((ref) => !refs.includes(ref))
    : [...selected, ...refs.filter((ref) => !selected.includes(ref))];
};

const chipTargets = (draft: EditorDraft, valueId: string, filter: string | null) => selectable(draft, filter).filter((row) => hasValue(row, valueId));

export const toggleChip = (draft: EditorDraft, selected: readonly string[], valueId: string, filter: string | null = null): readonly string[] =>
  toggled(selected, chipTargets(draft, valueId, filter));
export const toggleAll = (draft: EditorDraft, selected: readonly string[], filter: string | null = null): readonly string[] =>
  toggled(selected, selectable(draft, filter));
export function isChipActive(draft: EditorDraft, selected: readonly string[], valueId: string, filter: string | null = null): boolean {
  const targets = chipTargets(draft, valueId, filter);
  return targets.length > 0 && targets.every((row) => selected.includes(row.ref));
}
/** Selected rows the value filter hides. */
export function hiddenSelectedCount(draft: EditorDraft, selected: readonly string[], filter: string | null): number {
  return filter === null ? 0 : liveRows(draft).filter((row) => selected.includes(row.ref) && !hasValue(row, filter)).length;
}

// Request bodies

const skuOf = (sku: string | null) => sku?.trim() || null;

/** Options without a live value are left out: they carry no variant, and core drops them anyway. */
const bodyOptions = (draft: EditorDraft) => liveOptions(draft).filter((option) => liveValues(option).length > 0);

function optionsBody(draft: EditorDraft): CreateProductRequest["options"] {
  return bodyOptions(draft).map((option) => ({
    id: option.id, name: option.name, values: liveValues(option).map((value) => ({ id: value.id, name: value.name })),
    ...(draft.saved && !option.saved ? { valueForExistingVariants: keptValueId(option) ?? option.valueForExistingVariants ?? "" } : {}),
  }));
}

function newVariantsBody(draft: EditorDraft): CreateProductRequest["variants"] {
  const options = bodyOptions(draft);
  return liveRows(draft).filter((row) => row.id === null).map((row) => ({
    values: options.map((option) => row.combination[option.id]), sku: skuOf(row.sku), salePrice: row.salePrice,
    purchasePrice: row.purchasePrice, initialStock: row.stock,
  }));
}

export function buildCreateProductBody(draft: EditorDraft, meta: ProductMeta & Readonly<{ id: string; currency: CreateProductRequest["currency"]; hidden: boolean }>): CreateProductRequest {
  const { base } = draft;
  const withoutOptions = draft.options.length === 0;
  return {
    id: meta.id, name: meta.name, description: meta.description,
    photoIds: meta.photos.kind === "set" ? [...meta.photos.photoIds] : [], hidden: meta.hidden, currency: meta.currency,
    options: optionsBody(draft),
    variants: withoutOptions
      ? [{ values: [], sku: skuOf(base.sku), salePrice: base.salePrice, purchasePrice: base.purchasePrice, initialStock: base.stock }]
      : newVariantsBody(draft),
  };
}

export function buildSaveProductBody(draft: EditorDraft, meta: ProductMeta & Readonly<{ structureVersion: number; visibility: VisibilityToSave }>): SaveProductRequest {
  const live = liveRows(draft).filter((row) => row.id !== null);
  const changed = live.filter((row) => row.original && (skuOf(row.sku) !== row.original.sku || row.salePrice !== row.original.salePrice || row.purchasePrice !== row.original.purchasePrice));
  return {
    structureVersion: meta.structureVersion, name: meta.name, description: meta.description,
    ...meta.photos.kind === "set" ? { photoIds: [...meta.photos.photoIds] } : {},
    ...meta.visibility.kind === "set" ? { hidden: meta.visibility.hidden } : {},
    options: optionsBody(draft),
    variants: changed.map((row) => ({ id: row.id as string, sku: skuOf(row.sku), salePrice: row.salePrice, purchasePrice: row.purchasePrice })),
    newVariants: newVariantsBody(draft),
    deletedVariantIds: draft.rows.filter((row) => row.id !== null && removalOf(draft, row) !== null).map((row) => row.id as string),
  };
}
