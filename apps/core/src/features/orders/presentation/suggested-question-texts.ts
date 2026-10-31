import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

type Language = SuggestedQuestion["language"];
type Question<K extends SuggestedQuestion["kind"]> = Extract<SuggestedQuestion, { kind: K }>;

/** The catalog names attributes in the store's language; the common ones read naturally in Portuguese. */
const portugueseAttributes: Readonly<Record<string, string>> = { talla: "tamanho", color: "cor", colour: "cor" };

const conjunctions: Readonly<Record<Language, string>> = { es: "o", pt: "ou" };

/** «A», «A o B», «A, B o C». */
function listOf(items: readonly string[], language: Language) {
  const conjunction = conjunctions[language];
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

const attributeIn = (attribute: string, language: Language) => (language === "pt" ? portugueseAttributes[attribute.toLowerCase()] ?? attribute : attribute);
const withValues = (values: readonly string[], language: Language) => (values.length ? `: ${listOf(values, language)}` : "");

type Texts = Readonly<{ [K in SuggestedQuestion["kind"]]: (question: Question<K>) => string }>;

/** The questions never say what is in stock: they name catalog products and values and ask. */
const texts: Readonly<Record<Language, Texts>> = {
  es: {
    which_variant: (q) => `¿En qué ${q.attribute} quieres el ${q.product}${withValues(q.values, "es")}?`,
    which_product: (q) => `¿Cuál de estos quieres: ${listOf(q.products, "es")}?`,
    variant_unavailable: (q) => `El ${q.product} no viene en ${q.asked}. ¿En qué ${q.attribute} lo quieres${withValues(q.values, "es")}?`,
    variant_for_which: (q) => `¿De cuál lo quieres en ${q.value}: ${listOf(q.products, "es")}?`,
    which_item_to_remove: (q) => `¿Cuál quieres quitar: ${listOf(q.products, "es")}?`,
    which_product_for_value: (q) => `¿En cuál lo quieres en ${q.value}: ${listOf(q.products, "es")}?`,
    another_of_which: () => "¿Otro de cuál producto?",
    photo_product_name: () => "¿Cómo se llama el producto de la foto?",
    product_gone: (q) => `¿Quieres ver otro producto en lugar de ${q.product}?`,
  },
  pt: {
    which_variant: (q) => `Em qual ${attributeIn(q.attribute, "pt")} você quer o ${q.product}${withValues(q.values, "pt")}?`,
    which_product: (q) => `Qual destes você quer: ${listOf(q.products, "pt")}?`,
    variant_unavailable: (q) => `O ${q.product} não vem em ${q.asked}. Em qual ${attributeIn(q.attribute, "pt")} você quer${withValues(q.values, "pt")}?`,
    variant_for_which: (q) => `De qual você quer em ${q.value}: ${listOf(q.products, "pt")}?`,
    which_item_to_remove: (q) => `Qual você quer remover: ${listOf(q.products, "pt")}?`,
    which_product_for_value: (q) => `Em qual você quer em ${q.value}: ${listOf(q.products, "pt")}?`,
    another_of_which: () => "Mais um de qual produto?",
    photo_product_name: () => "Qual é o nome do produto da foto?",
    product_gone: (q) => `Quer ver outro produto no lugar de ${q.product}?`,
  },
};

/** The question in the buyer's language, as the seller may send it. Catalog names and values only, never buyer text. */
export function suggestedQuestionText(question: SuggestedQuestion): string {
  const render = texts[question.language][question.kind] as (question: SuggestedQuestion) => string;
  return render(question);
}
