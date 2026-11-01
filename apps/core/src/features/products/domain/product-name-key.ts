/**
 * Accents removed when two product names are compared, as the characters of `from` and their replacements in `to` (same length).
 * The SQL of the text candidates builds the same key with `translate(lower(name), from, to)` from this constant.
 */
export const productNameFolds = { from: "áàâäãéèêëíìîïóòôöõúùûüñç", to: "aaaaaeeeeiiiiooooouuuunc" } as const;

const replacements = new Map([...productNameFolds.from].map((character, index) => [character, [...productNameFolds.to][index]!]));

/** Two products have the same name when their keys are equal: lower case and the accents of `productNameFolds` removed. */
export function productNameKey(name: string): string {
  return [...name.toLowerCase()].map((character) => replacements.get(character) ?? character).join("");
}
