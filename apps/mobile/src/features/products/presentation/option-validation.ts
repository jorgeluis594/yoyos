import { productOptionLimits, normalizeOptionText } from "@shared/contracts/products";
import type { EditorOption } from "@shared/product-variants";
import i18n from "@mobile/i18n";

export type OptionIssues = Readonly<{ name?: string; values: Readonly<Record<string, string>>; general?: string }>;

type Named = Readonly<{ id: string; text: string }>;

/** The rules of names and values (§ «Editor de opción»), on what is typed. Core validates again. */
export function optionIssues(name: string, values: readonly Named[], otherOptionNames: readonly string[]): OptionIssues {
  const result: { name?: string; values: Record<string, string>; general?: string } = { values: {} };
  const trimmed = name.trim();
  if (!trimmed) result.name = i18n.t("optionNameRequired");
  else if ([...trimmed].length > productOptionLimits.nameLength) result.name = i18n.t("maxCharacters", { count: productOptionLimits.nameLength });
  else if (otherOptionNames.some((other) => normalizeOptionText(other) === normalizeOptionText(trimmed))) result.name = i18n.t("optionDuplicated", { name: trimmed });
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.text.trim();
    if (!text) continue;
    if ([...text].length > productOptionLimits.nameLength) result.values[value.id] = i18n.t("maxCharacters", { count: productOptionLimits.nameLength });
    else if (seen.has(normalizeOptionText(text))) result.values[value.id] = i18n.t("valueDuplicated", { name: text });
    seen.add(normalizeOptionText(text));
  }
  const filled = values.filter((value) => value.text.trim());
  if (filled.length === 0) result.general = i18n.t("optionNeedsValue");
  else if (filled.length > productOptionLimits.valuesPerOption) result.general = i18n.t("tooManyValues", { count: productOptionLimits.valuesPerOption });
  return result;
}

export const hasIssues = (issues: OptionIssues) => !!issues.name || !!issues.general || Object.keys(issues.values).length > 0;

/** Issues of an option already in the draft: marked values do not count, and an emptied name or value is flagged. */
export function savedOptionIssues(option: EditorOption, otherOptionNames: readonly string[]): OptionIssues {
  const live = option.values.filter((value) => !value.marked);
  const issues = optionIssues(option.name, live.map((value) => ({ id: value.id, text: value.name })), otherOptionNames);
  const empty = Object.fromEntries(live.filter((value) => !value.name.trim()).map((value) => [value.id, i18n.t("valueRequired")]));
  return { ...issues, values: { ...issues.values, ...empty } };
}
