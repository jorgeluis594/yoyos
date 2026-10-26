/** Rules shared by the editors on web and mobile. Advisory: core validates everything again. */

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
