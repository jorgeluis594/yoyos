import { baseFormsOf, normalizeWord } from "@core/src/features/products/domain/variant-words";

/**
 * A text that only names a variant («en XS», «celeste porfa», «la prefiero en talla 38») never changes an item and reports
 * `variant_only` (docs/message-to-order.md «Change variant»). Read here without a model: every word is a size, a color, a value of an
 * open order item, an attribute name or a word that carries no request of its own. A product name, a change verb («cambia», «mejor»,
 * «pasa»), a quantity or a question mark leaves the text to the models.
 */

const colorWords: ReadonlySet<string> = new Set(["negro", "blanco", "rojo", "azul", "verde", "amarillo", "gris", "plomo", "rosado", "rosa", "fucsia", "morado",
  "lila", "violeta", "celeste", "turquesa", "marron", "cafe", "beige", "crema", "hueso", "naranja", "anaranjado", "mostaza", "guinda", "dorado", "plateado",
  "melange", "jaspeado", "camel", "caqui", "coral", "salmon", "perla", "marino", "petroleo", "nude", "multicolor"]);
const sizeWords: ReadonlySet<string> = new Set(["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "2xl", "3xl", "unica", "estandar", "standard", "chico", "chica",
  "mediano", "mediana", "grande"]);
/** Words before a size number («talla 38»), which alone is no quantity. */
const attributeWords: ReadonlySet<string> = new Set(["talla", "color", "tono", "numero", "size", "cor", "tamanho"]);
/** Articles, prepositions, wanting and courtesy: none of them asks for a change, a product or a quantity. */
const neutralWords: ReadonlySet<string> = new Set(["en", "de", "del", "la", "lo", "el", "las", "los", "y", "o", "me", "quiero", "kiero", "necesito", "nesecito",
  "prefiero", "gustaria", "porfa", "porfis", "plis", "pls", "xfa", "x", "fa", "por", "favor", "gracias", "amiga", "amigo", "ya", "ok", "eu", "quero", "prefiro"]);

const tokensOf = (text: string) => normalizeWord(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isColor = (token: string) => baseFormsOf(token).some((form) => colorWords.has(form));

/** `itemValues`: the variant values of the open order's items, which may be sizes or colors no list above has («Única», «38»). */
export function isVariantOnlyText(text: string, itemValues: readonly string[]): boolean {
  if (/[?¿]/.test(text)) return false;
  const values = new Set(itemValues.flatMap(tokensOf));
  const tokens = tokensOf(text);
  const isValue = (token: string, index: number) => isColor(token) || sizeWords.has(token) || (values.has(token) && !/^\d+$/.test(token))
    // A number is a size only after its attribute word; alone it is a quantity.
    || (/^\d+$/.test(token) && index > 0 && attributeWords.has(tokens[index - 1]!));
  return tokens.some(isValue) && tokens.every((token, index) => isValue(token, index) || attributeWords.has(token) || neutralWords.has(token));
}
