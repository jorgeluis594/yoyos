/**
 * How buyers write variant values: Spanish plural, feminine or masculine and diminutive forms of a value word («rojas» is Rojo,
 * «grises» is Gris, «blanquita» is Blanco, «verdecito» is Verde). Pure and deterministic, so a value is recognized without a model.
 */

export const normalizeWord = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** The forms a written word may stand for, itself included: without the plural, with the other gender ending, without a diminutive. */
export function baseFormsOf(word: string): readonly string[] {
  const token = normalizeWord(word);
  const forms = new Set([token]);
  // Short words («es», «las») are no plural of a value; the stem keeps at least three letters.
  const add = (form: string) => { if (form.length >= 3) forms.add(form); };
  if (token.length > 4 && /[^aeiou]es$/.test(token)) add(token.slice(0, -2));
  if (token.length > 3 && token.endsWith("s")) add(token.slice(0, -1));
  for (const form of [...forms]) {
    const diminutive = /^(.{3,}?)(?:ec)?it[oa]$/.exec(form);
    if (diminutive) {
      // «blanquito» → blanc-, «amiguita» → amig-: the spelling change before -ito undone.
      const stem = diminutive[1]!.replace(/qu$/, "c").replace(/gu$/, "g");
      for (const ending of ["", "o", "a", "e"]) add(`${stem}${ending}`);
    }
  }
  for (const form of [...forms]) if (/[^aeiou][oa]$/.test(form)) { add(`${form.slice(0, -1)}o`); add(`${form.slice(0, -1)}a`); }
  return [...forms];
}

/**
 * The value word a written word stands for, among `valueWords` (normalized single words of the sellable values): the word itself when
 * it is one, else the only value word among its forms; null when it names none or more than one.
 */
export function valueWordOf(word: string, valueWords: ReadonlySet<string>): string | null {
  const token = normalizeWord(word);
  if (valueWords.has(token)) return token;
  const matches = baseFormsOf(token).filter((form) => valueWords.has(form));
  return matches.length === 1 ? matches[0]! : null;
}
