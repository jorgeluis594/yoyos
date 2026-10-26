import { normalizeOptionText, productOptionLimits } from "@shared/contracts/products";
import { addOption, addValue, moveValue, renameOption, renameValue, variantCounter, type Edit, type EditorDraft, type EditorOption } from "@shared/product-variants";
import { ok } from "@shared/functional";

/** What the seller types in one option editor before pressing «Listo». Nothing reaches the draft until then. */
export type BufferValue = Readonly<{ id: string; text: string }>;
export type OptionBuffer = Readonly<{
  optionId: string;
  /** True while the option is not in the draft yet. */
  isNew: boolean;
  name: string;
  values: readonly BufferValue[];
  /** Only for an option added to a saved product: the value its existing variants receive. */
  valueForExistingVariants: string | null;
}>;

export type OptionIssue =
  | Readonly<{ kind: "NAME_REQUIRED" }>
  | Readonly<{ kind: "NAME_TOO_LONG" }>
  | Readonly<{ kind: "NAME_DUPLICATE"; name: string }>
  | Readonly<{ kind: "VALUE_REQUIRED"; valueId: string }>
  | Readonly<{ kind: "VALUE_TOO_LONG"; valueId: string }>
  | Readonly<{ kind: "VALUE_DUPLICATE"; valueId: string; text: string }>
  | Readonly<{ kind: "NO_VALUES" }>
  | Readonly<{ kind: "TOO_MANY_VALUES"; maximum: number }>
  | Readonly<{ kind: "TOO_MANY_OPTIONS"; maximum: number }>
  | Readonly<{ kind: "TOO_MANY_VARIANTS"; maximum: number; projected: number; saved: boolean; current: number; counts: readonly Readonly<{ name: string; count: number }>[] }>;

const { nameLength } = productOptionLimits;

export const newOptionBuffer = (optionId: string): OptionBuffer => ({ optionId, isNew: true, name: "", values: [], valueForExistingVariants: null });

export const bufferFromOption = (option: EditorOption): OptionBuffer => ({
  optionId: option.id, isNew: false, name: option.name, valueForExistingVariants: option.valueForExistingVariants,
  values: option.values.map((value) => ({ id: value.id, text: value.name })),
});

const trimmed = (text: string) => text.trim();
const filled = (buffer: OptionBuffer) => buffer.values.filter((value) => trimmed(value.text) !== "");

function markedIds(draft: EditorDraft, optionId: string): ReadonlySet<string> {
  const option = draft.options.find((candidate) => candidate.id === optionId);
  return new Set(option?.values.filter((value) => value.marked).map((value) => value.id));
}

/** Values the buffer keeps: typed ones and, for a saved option, the ones the seller already marked for removal are not counted. */
const liveBufferValues = (draft: EditorDraft, buffer: OptionBuffer) => {
  const marked = markedIds(draft, buffer.optionId);
  return filled(buffer).filter((value) => !marked.has(value.id));
};

function fieldIssues(draft: EditorDraft, buffer: OptionBuffer): readonly OptionIssue[] {
  const issues: OptionIssue[] = [];
  const name = trimmed(buffer.name);
  if (name === "") issues.push({ kind: "NAME_REQUIRED" });
  else if ([...name].length > nameLength) issues.push({ kind: "NAME_TOO_LONG" });
  else if (draft.options.some((option) => option.id !== buffer.optionId && normalizeOptionText(option.name) === normalizeOptionText(name))) issues.push({ kind: "NAME_DUPLICATE", name });
  const marked = markedIds(draft, buffer.optionId);
  const seen = new Set<string>();
  for (const value of buffer.values) {
    const text = trimmed(value.text);
    if (marked.has(value.id)) continue;
    const saved = draft.options.some((option) => option.id === buffer.optionId && option.values.some((candidate) => candidate.id === value.id));
    if (text === "") { if (saved) issues.push({ kind: "VALUE_REQUIRED", valueId: value.id }); continue; }
    if ([...text].length > nameLength) issues.push({ kind: "VALUE_TOO_LONG", valueId: value.id });
    const key = normalizeOptionText(text);
    if (seen.has(key)) issues.push({ kind: "VALUE_DUPLICATE", valueId: value.id, text });
    seen.add(key);
  }
  const live = liveBufferValues(draft, buffer);
  if (live.length === 0) issues.push({ kind: "NO_VALUES" });
  if (live.length > productOptionLimits.valuesPerOption) issues.push({ kind: "TOO_MANY_VALUES", maximum: productOptionLimits.valuesPerOption });
  return issues;
}

function limitIssue(draft: EditorDraft, buffer: OptionBuffer, failure: Readonly<{ code: string; projected?: number; maximum?: number }>): OptionIssue | null {
  if (failure.code === "TOO_MANY_OPTIONS") return { kind: "TOO_MANY_OPTIONS", maximum: failure.maximum ?? productOptionLimits.options };
  if (failure.code !== "TOO_MANY_VARIANTS") return null;
  const maximum = failure.maximum ?? productOptionLimits.variants;
  const projected = failure.projected ?? maximum + 1;
  const counts = draft.options.filter((option) => !option.marked && option.id !== buffer.optionId)
    .map((option) => ({ name: option.name, count: option.values.filter((value) => !value.marked).length }));
  counts.push({ name: trimmed(buffer.name), count: liveBufferValues(draft, buffer).length });
  return { kind: "TOO_MANY_VARIANTS", maximum, projected, saved: draft.saved, current: variantCounter(draft).count, counts };
}

const typed = (buffer: OptionBuffer) => filled(buffer).map((value) => ({ id: value.id, name: trimmed(value.text) }));

/** Applies the buffer to the draft with the shared rules. Fails with the rule that stopped it. */
export function applyOptionBuffer(draft: EditorDraft, buffer: OptionBuffer): Edit {
  const name = trimmed(buffer.name);
  if (buffer.isNew) {
    const values = typed(buffer);
    return addOption(draft, { id: buffer.optionId, name, values, ...(buffer.valueForExistingVariants ? { valueForExistingVariants: buffer.valueForExistingVariants } : {}) });
  }
  const option = draft.options.find((candidate) => candidate.id === buffer.optionId);
  if (!option) return addOption(draft, { id: buffer.optionId, name, values: typed(buffer) });
  const saved = new Set(option.values.map((value) => value.id));
  let next = renameOption(draft, buffer.optionId, name);
  for (const value of typed(buffer)) if (saved.has(value.id)) next = renameValue(next, value.id, value.name);
  for (const value of typed(buffer)) {
    if (saved.has(value.id)) continue;
    const added = addValue(next, buffer.optionId, value);
    if (!added.success) return added;
    next = added.data;
  }
  const order = [...buffer.values.filter((value) => saved.has(value.id) || trimmed(value.text) !== "").map((value) => value.id)];
  order.forEach((id, index) => { next = moveValue(next, buffer.optionId, id, index); });
  return ok(next);
}

/** Every problem the seller must fix before «Listo» works, in field order. */
export function optionIssues(draft: EditorDraft, buffer: OptionBuffer): readonly OptionIssue[] {
  const fields = fieldIssues(draft, buffer);
  if (fields.length > 0) return fields;
  const applied = applyOptionBuffer(draft, buffer);
  if (applied.success) return [];
  const limit = limitIssue(draft, buffer, applied.error);
  return limit ? [limit] : [];
}

/** Whether the buffer differs from what the draft holds, so «X» knows to ask before discarding. */
export function bufferChanged(draft: EditorDraft, buffer: OptionBuffer): boolean {
  if (buffer.isNew) return trimmed(buffer.name) !== "" || filled(buffer).length > 0;
  const option = draft.options.find((candidate) => candidate.id === buffer.optionId);
  if (!option) return true;
  const original = bufferFromOption(option);
  return original.name !== buffer.name || original.valueForExistingVariants !== buffer.valueForExistingVariants
    || JSON.stringify(original.values) !== JSON.stringify(filled(buffer));
}
