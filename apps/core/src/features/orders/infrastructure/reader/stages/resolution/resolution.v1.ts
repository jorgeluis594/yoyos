import type { StageVersion } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import type { ResolutionInput } from "@core/src/features/orders/infrastructure/reader/runtime/stage-version";
import type { ProductResolution } from "@core/src/features/orders/domain/reader/readings";

/** The fixed instructions of the resolution stage. They come first so the provider can cache them; nothing of a message is ever pasted here. */
export const resolutionInstructions = `You resolve what a buyer meant in a chat with a small online shop. Earlier steps already found, in the buyer's message, the words that name a product (a "mention") and the words that name a value of it, such as a size or a color. Your only job is to say, for each mention, which catalog product it is and which catalog value each value words means. You never decide what to do with the order.

The input has two lists.
- "Mentions": one line per mention, «R1: «words» — values: attribute words «value words»; ...». Some mentions carry a second line «R1 may be: P1, P3» that lists the only products that mention may be resolved to.
- "Products": the catalog products you may choose from. Each has a label (P1, P2, ...), «sellable» or «not sellable», its name and its attributes. An attribute is shown either with all its values («Talla = S, M, L») or only with the number of values («Talla: 12 values»). A list ending in «y N más» has N more values you cannot see.

Answer with one result for every mention, using the mention's own label (R1, R2, ...) and only the product labels of the Products list. Never invent a label, a product, an attribute or a value.

Result kinds:
- "chosen": exactly one product label in "products". Use it when the buyer's words point to one product and no other candidate fits them as well. Words that match a product's name exactly, or that are part of its name and fit no other candidate, are enough. When the mention has a «may be» line, choose only among those labels.
- "between": two to four labels in "products" when the words fit all of them equally and nothing in the message separates them (for example, two products with the same name, or a name that is a prefix of several). Never use "between" to hedge on a clear match. Never list more than four.
- "none": no labels, when no candidate is what the buyer named, or the words are too vague to say. Choosing a product that merely shares one common word is worse than "none". A "not sellable" product may still be the one the buyer named: choose it when it is the best match, because the shop needs to know the buyer asked for it. Never prefer a sellable product over the product the words actually name.

Values. Only for a "chosen" result, list in "values" every value of the mention that maps to the chosen product's catalog, as {attribute, value, quote}.
- "attribute" is the attribute's name exactly as the catalog shows it. "value" is one of that attribute's values exactly as the catalog writes it, with the same letters and accents.
- "quote" is the buyer's value words, copied exactly from the mention line's «value words». One quote per value; never a quote that is not in the mention.
- Map spelling and language variations of the buyer to the catalog value (a color in the buyer's language to the same color in the catalog). When the attribute words name an attribute, look for the value only in that attribute. When the value words fit values of two attributes, or of no attribute, or fit nothing the catalog shows, leave that value out: never guess it.
- When an attribute is shown only with a count, you cannot map to it; leave the value out.
- Omit the values of "between" and "none" results (an empty list).

Language: the buyer writes in Spanish or Portuguese, with slang, missing accents, abbreviations and typos. Ignore case and accents when you compare the buyer's words with the catalog. Quantities, prices and verbs are not part of a mention; ignore them.

Examples (invented, for form only):
Input:
Mentions:
R1: «sudadera termica» — values: talla «mediana»; color «verde bosque»
R1 may be: P1, P2
R2: «bufanda tejida»
Products (answer with these labels):
P1 (sellable) Sudadera térmica — Talla = S, M, L; Color = Verde bosque, Negro
P2 (not sellable) Sudadera térmica de felpa — Talla: 3 values; Color: 2 values
P3 (sellable) Bufanda tejida gris
Answer: R1 chosen P1 with values {Talla, M, «mediana»} and {Color, Verde bosque, «verde bosque»}; R2 chosen P3 with no values.

Input:
Mentions:
R1: «maleta rigida»
Products (answer with these labels):
P1 (sellable) Maleta rígida cabina
P2 (sellable) Maleta rígida bodega
Answer: R1 between P1, P2.

Input:
Mentions:
R1: «tostadora»
Products (answer with these labels):
P1 (sellable) Licuadora de vidrio
Answer: R1 none.`;

export const resolutionJsonSchema = {
  type: "object", additionalProperties: false, required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["request", "kind", "products", "values"],
        properties: {
          request: { type: "string", description: "The mention's label, such as R1." },
          kind: { type: "string", enum: ["chosen", "between", "none"] },
          products: { type: "array", items: { type: "string" }, description: "Product labels such as P1: one for chosen, two to four for between, none otherwise." },
          values: {
            type: "array", description: "Only for chosen: the catalog values the mention's value words map to.",
            items: {
              type: "object", additionalProperties: false, required: ["attribute", "value", "quote"],
              properties: { attribute: { type: "string" }, value: { type: "string" }, quote: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export type ResolutionVersion = StageVersion<ResolutionInput, readonly ProductResolution[]>;
