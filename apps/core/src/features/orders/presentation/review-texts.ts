import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

const list = (values: readonly string[], or: string) => (values.length < 2 ? (values[0] ?? "") : `${values.slice(0, -1).join(", ")} ${or} ${values.at(-1)}`);

/** The buyer-facing question of a point, written in the buyer's language. Only Spanish and Portuguese exist. */
export function renderSuggestedQuestion(question: SuggestedQuestion): string {
  const pt = question.language === "pt";
  const or = pt ? "ou" : "o";
  switch (question.kind) {
    case "which_variant":
      return pt ? `Qual ${question.attribute} você quer${question.values.length ? ` (${list(question.values, or)})` : ""} para ${question.product}?`
        : `¿Qué ${question.attribute} quieres${question.values.length ? ` (${list(question.values, or)})` : ""} para ${question.product}?`;
    case "which_product":
      return pt ? `Qual destes você quer: ${list(question.products, or)}?` : `¿Cuál de estos quieres: ${list(question.products, or)}?`;
    case "variant_unavailable":
      return pt ? `Não temos ${question.product} em ${question.asked}. Qual ${question.attribute} prefere${question.values.length ? ` (${list(question.values, or)})` : ""}?`
        : `No tenemos ${question.product} en ${question.asked}. ¿Qué ${question.attribute} prefieres${question.values.length ? ` (${list(question.values, or)})` : ""}?`;
    case "variant_for_which":
      return pt ? `Para qual produto é ${question.value}: ${list(question.products, or)}?` : `¿Para cuál producto es ${question.value}: ${list(question.products, or)}?`;
    case "which_item_to_remove":
      return pt ? `Qual destes quer tirar: ${list(question.products, or)}?` : `¿Cuál de estos quieres quitar: ${list(question.products, or)}?`;
    case "which_product_for_value":
      return pt ? `A que produto se refere ${question.value}: ${list(question.products, or)}?` : `¿A qué producto te refieres con ${question.value}: ${list(question.products, or)}?`;
    case "another_of_which":
      return pt ? "Quer outro de qual produto?" : "¿Quieres otro de cuál producto?";
    case "photo_product_name":
      return pt ? "Qual é o nome do produto da foto?" : "¿Cuál es el nombre del producto de la foto?";
    case "product_gone":
      return pt ? `${question.product} já não está disponível. Quer outra opção?` : `${question.product} ya no está disponible. ¿Quieres otra opción?`;
  }
}
