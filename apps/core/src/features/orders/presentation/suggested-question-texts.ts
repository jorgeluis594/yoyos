import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

type Language = SuggestedQuestion["language"];
type Question<K extends SuggestedQuestion["kind"]> = Extract<SuggestedQuestion, { kind: K }>;

/** The catalog names attributes in the store's language; the common ones read naturally in Portuguese. */
const portugueseAttributes: Readonly<Record<string, string>> = { talla: "tamanho", color: "cor", colour: "cor" };

const conjunctions: Readonly<Record<Language, string>> = { es: "o", pt: "ou" };

/** «A», «A o B», «A, B o C». */
function listOf(items: readonly string[], language: Language, conjunction = conjunctions[language]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

const attributeIn = (attribute: string, language: Language) => {
  const lower = attribute.toLocaleLowerCase(language);
  return language === "pt" ? portugueseAttributes[lower] ?? lower : lower;
};
const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);
/** « Tenemos S, M y L.» / « Temos S, M e L.», or nothing when the attribute has more than three values. */
const offered = (values: readonly string[], language: Language) =>
  values.length ? ` ${language === "pt" ? "Temos" : "Tenemos"} ${listOf(values, language, language === "pt" ? "e" : "y")}.` : "";

type Texts = Readonly<{ [K in SuggestedQuestion["kind"]]: (question: Question<K>) => string }>;

/**
 * The questions follow the product's patterns with one grammar rule: no articles and no gendered pronouns before catalog names,
 * which go first where the sentence needs them, so a feminine or masculine name reads right without gender rules in code.
 */
const texts: Readonly<Record<Language, Texts>> = {
  es: {
    which_variant: (q) => `${q.product}: ¿en qué ${attributeIn(q.attribute, "es")}?${offered(q.values, "es")}`,
    which_product: (q) => `¿Cuál de estos quieres: ${listOf(q.products, "es")}?`,
    variant_unavailable: (q) => `${q.product} no viene en ${q.asked}. ¿En qué ${attributeIn(q.attribute, "es")}?${offered(q.values, "es")}`,
    variant_for_which: (q) => `${capitalized(attributeIn(q.attribute, "es"))} ${q.value}: ¿para cuál de estos? ${listOf(q.products, "es")}.`,
    which_item_to_remove: (q) => `¿Cuál quieres quitar: ${listOf(q.products, "es")}?`,
    which_product_for_value: (q) => `¿Cuál quieres en ${q.value}: ${listOf(q.products, "es")}?`,
    another_of_which: () => "¿De cuál producto quieres otro?",
    photo_product_name: () => "¿Me dices el nombre del producto de la foto?",
    product_gone: (q) => `Ya no tenemos ${q.product}. ¿Te muestro otra opción?`,
  },
  pt: {
    which_variant: (q) => `${q.product}: em qual ${attributeIn(q.attribute, "pt")}?${offered(q.values, "pt")}`,
    which_product: (q) => `Qual destes você quer: ${listOf(q.products, "pt")}?`,
    variant_unavailable: (q) => `${q.product} não vem em ${q.asked}. Em qual ${attributeIn(q.attribute, "pt")}?${offered(q.values, "pt")}`,
    variant_for_which: (q) => `${capitalized(attributeIn(q.attribute, "pt"))} ${q.value}: para qual destes? ${listOf(q.products, "pt")}.`,
    which_item_to_remove: (q) => `Qual você quer remover: ${listOf(q.products, "pt")}?`,
    which_product_for_value: (q) => `Qual você quer em ${q.value}: ${listOf(q.products, "pt")}?`,
    another_of_which: () => "De qual produto você quer mais um?",
    photo_product_name: () => "Pode me dizer o nome do produto da foto?",
    product_gone: (q) => `Não temos mais ${q.product}. Quer ver outra opção?`,
  },
};

/** The question in the buyer's language, as the seller may send it. Catalog names and values only, never buyer text. */
export function suggestedQuestionText(question: SuggestedQuestion): string {
  const render = texts[question.language][question.kind] as (question: SuggestedQuestion) => string;
  return render(question);
}
