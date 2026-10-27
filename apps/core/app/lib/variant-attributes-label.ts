/** «L / Azul»: the value names of a variant in the order they arrive, which is the saved option order. The same format as the shared `combinationLabel`, for surfaces that only carry the attributes. */
export const attributesLabel = (attributes: Readonly<Record<string, string>>): string => Object.values(attributes).join(" / ");
