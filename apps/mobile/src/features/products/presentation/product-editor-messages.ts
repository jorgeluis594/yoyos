import { orderedRows, removalOf, type EditFailure, type EditorDraft, type EditorOption, type EditorRow } from "@shared/product-variants";
import type { CreateProductError, SaveProductError } from "../infrastructure/product-api";
import { noEditorErrors, type EditorErrors } from "./product-editor-state";
import i18n from "@mobile/i18n";

/** «tallas», «colores», «mangas»: the option name in lower case, plural enough for the limit message. */
function plural(name: string) {
  const lower = name.trim().toLowerCase();
  return /[aeiouáéíóú]$/.test(lower) ? `${lower}s` : `${lower}es`;
}

const liveOptions = (draft: EditorDraft) => draft.options.filter((option) => !option.marked);
const liveValues = (option: EditorOption) => option.values.filter((value) => !value.marked);
const liveRows = (draft: EditorDraft) => orderedRows(draft).filter((row) => removalOf(draft, row) === null);

/** «Máximo 100 variantes» plus the arithmetic behind it. `added` is the option about to be added, if any. */
export function limitMessage(draft: EditorDraft, projected: number, added?: Readonly<{ name: string; values: number }>): string {
  if (draft.saved) {
    const current = liveRows(draft).length;
    return i18n.t("variantLimitSaved", { projected, current, added: projected - current });
  }
  const parts = [...liveOptions(draft).map((option) => ({ name: option.name, count: liveValues(option).length })), ...(added ? [{ name: added.name, count: added.values }] : [])];
  const product = parts.map((part) => `${part.count} ${plural(part.name)}`).join(" × ");
  return i18n.t("variantLimitNew", { projected, product });
}

/** The text for a rejected editor operation, or null when the operation needs none. */
export function editFailureMessage(failure: EditFailure, context: Readonly<{ draft: EditorDraft; name?: string; added?: Readonly<{ name: string; values: number }> }>): string {
  switch (failure.code) {
    case "TOO_MANY_VARIANTS": return `${i18n.t("variantLimitTitle")}. ${limitMessage(context.draft, failure.projected ?? 0, context.added)}`;
    case "TOO_MANY_VALUES": return i18n.t("tooManyValues", { count: failure.maximum ?? 30 });
    case "TOO_MANY_OPTIONS": return i18n.t("maxOptionsReached");
    case "OPTION_WITHOUT_VALUES": return i18n.t("optionNeedsValue");
    case "VARIANT_HAS_ORDERS_OR_STOCK": return i18n.t("cannotDeleteValue", { name: context.name ?? "", count: failure.blocked ?? 0 });
    case "VALUE_FOR_EXISTING_VARIANTS": return i18n.t("chooseAnotherForExisting", { name: context.name ?? "" });
    case "OPTION_HAS_SEVERAL_VALUES": return i18n.t("leaveOneValue", { name: context.name ?? "" });
    case "LAST_OPTION_VARIANT_INACTIVE": return i18n.t("activateBeforeLastOption");
    case "DUPLICATE_COMBINATION": return i18n.t("duplicateCombinationShort");
    default: return i18n.t("reviewProductData");
  }
}

type Rejection = SaveProductError | CreateProductError;
type Issue = NonNullable<Extract<Rejection, { code: "VALIDATION_ERROR" | "INVALID_INPUT" }>["issues"]>[number];

/** The shape the save request had: live options with live values, and the new rows in request order. */
function requestShape(draft: EditorDraft) {
  const options = liveOptions(draft).filter((option) => liveValues(option).length > 0).map((option) => ({ option, values: liveValues(option) }));
  const created = liveRows(draft).filter((row) => row.id === null);
  return { options, created };
}

function rowMessage(issue: Issue): string {
  if (issue.field === "sku" || issue.reason === "DUPLICATE_SKU") return i18n.t("skuInUseByVariant");
  if (issue.field === "salePrice") return issue.reason === "INVALID_PRECISION" ? i18n.t("maxTwoDecimals") : i18n.t("missingPrice");
  if (issue.field === "purchasePrice") return issue.reason === "INVALID_PRECISION" ? i18n.t("maxTwoDecimals") : i18n.t("purchasePriceInvalid");
  if (issue.field === "initialStock") return i18n.t("initialStockInvalid");
  if (issue.reason === "DUPLICATE_COMBINATION" || issue.reason === "DUPLICATE_VARIANT") return i18n.t("duplicateCombinationShort");
  return i18n.t("reviewVariant");
}

function valueMessage(issue: Issue, name: string): string {
  if (["VALUE_IN_USE", "VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK"].includes(issue.reason)) return i18n.t("cannotDeleteValueNow", { name });
  if (issue.reason === "DUPLICATE_VALUE") return i18n.t("valueDuplicated", { name });
  if (issue.reason === "TOO_LONG") return i18n.t("maxCharacters", { count: issue.maxLength ?? 30 });
  if (issue.reason === "REQUIRED") return i18n.t("valueRequired");
  return i18n.t("reviewProductData");
}

function optionMessage(issue: Issue, name: string): string {
  if (issue.reason === "DUPLICATE_OPTION") return i18n.t("optionDuplicated", { name });
  if (issue.reason === "TOO_LONG") return i18n.t("maxCharacters", { count: issue.maxLength ?? 30 });
  if (issue.reason === "REQUIRED") return i18n.t("optionNameRequired");
  if (issue.reason === "OPTION_WITHOUT_VALUES") return i18n.t("optionNeedsValue");
  if (issue.reason === "TOO_MANY_VALUES") return i18n.t("tooManyValues", { count: issue.maximum ?? 30 });
  if (issue.reason === "OPTION_HAS_SEVERAL_VALUES") return i18n.t("leaveOneValue", { name });
  if (issue.reason === "LAST_OPTION_VARIANT_INACTIVE") return i18n.t("activateBeforeLastOption");
  return i18n.t("reviewProductData");
}

/** Places each issue of a rejected save on the row, option or value the seller edited. Issues with no home are left to the form. */
export function editorErrorsOf(error: Rejection, draft: EditorDraft): EditorErrors {
  if (error.code !== "VALIDATION_ERROR" && error.code !== "INVALID_INPUT") return noEditorErrors;
  const { options, created } = requestShape(draft);
  const rows: Record<string, string> = {};
  const optionErrors: Record<string, string> = {};
  const values: Record<string, string> = {};
  const rowFor = (id: string | undefined, index: number | undefined): EditorRow | undefined =>
    id !== undefined ? draft.rows.find((row) => row.id === id) : index !== undefined ? created[index] : undefined;
  for (const issue of error.issues ?? []) {
    if (issue.scope === "variant" || issue.scope === "newVariant") {
      const row = rowFor(issue.scope === "variant" ? issue.variantId : undefined, issue.scope === "newVariant" ? issue.index : undefined);
      if (row) rows[row.ref] ??= rowMessage(issue);
    } else if (issue.scope === "value") {
      const option = options[issue.optionIndex ?? -1];
      const value = option?.values.find((candidate) => candidate.id === issue.valueId) ?? option?.values[issue.valueIndex ?? -1];
      if (value) values[value.id] ??= valueMessage(issue, value.name);
    } else if (issue.scope === "option") {
      const option = options.find((candidate) => candidate.option.id === issue.optionId) ?? options[issue.optionIndex ?? -1];
      if (option) optionErrors[option.option.id] ??= optionMessage(issue, option.option.name);
    }
  }
  return { rows, options: optionErrors, values };
}

export const rowErrorCount = (errors: EditorErrors) => Object.keys(errors.rows).length;
