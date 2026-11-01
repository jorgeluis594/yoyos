import { describe, expect, test } from "vitest";
import { suggestedQuestionText } from "@core/src/features/orders/presentation/suggested-question-texts";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

const es = <Q extends Omit<SuggestedQuestion, "language">>(question: Q) => suggestedQuestionText({ language: "es", ...question } as SuggestedQuestion);
const pt = <Q extends Omit<SuggestedQuestion, "language">>(question: Q) => suggestedQuestionText({ language: "pt", ...question } as SuggestedQuestion);

describe("suggestedQuestionText", () => {
  test("writes the which-variant question with the values in Spanish and Portuguese", () => {
    const question = { kind: "which_variant", product: "Polo básico", attribute: "talla", values: ["S", "M", "L"] } as const;
    expect(es(question)).toBe("Polo básico: ¿en qué talla? Tenemos S, M y L.");
    expect(pt(question)).toBe("Polo básico: em qual tamanho? Temos S, M e L.");
  });

  test("writes the which-variant question without values when the attribute has more than three", () => {
    const question = { kind: "which_variant", product: "Polo básico", attribute: "talla", values: [] } as const;
    expect(es(question)).toBe("Polo básico: ¿en qué talla?");
    expect(pt(question)).toBe("Polo básico: em qual tamanho?");
  });

  test("writes the question in Portuguese when the buyer wrote in Portuguese", () => {
    expect(pt({ kind: "which_product", products: ["Polo básico", "Polo premium"] })).toBe("Qual destes você quer: Polo básico ou Polo premium?");
    expect(es({ kind: "which_product", products: ["Polo básico", "Polo premium", "Gorra"] })).toBe("¿Cuál de estos quieres: Polo básico, Polo premium o Gorra?");
  });

  test("writes the rest of the kinds in both languages", () => {
    expect(es({ kind: "variant_unavailable", product: "Polo básico", asked: "XL", attribute: "talla", values: ["S", "M"] })).toBe("Polo básico no viene en XL. ¿En qué talla? Tenemos S y M.");
    expect(pt({ kind: "variant_unavailable", product: "Polo básico", asked: "XL", attribute: "talla", values: [] })).toBe("Polo básico não vem em XL. Em qual tamanho?");
    expect(es({ kind: "variant_for_which", attribute: "Talla", value: "M", products: ["Polo básico", "Gorra"] })).toBe("Talla M: ¿para cuál de estos? Polo básico o Gorra.");
    expect(pt({ kind: "variant_for_which", attribute: "Talla", value: "M", products: ["Polo básico", "Gorra"] })).toBe("Tamanho M: para qual destes? Polo básico ou Gorra.");
    expect(es({ kind: "which_item_to_remove", products: ["Polo básico", "Gorra"] })).toBe("¿Cuál quieres quitar: Polo básico o Gorra?");
    expect(pt({ kind: "which_item_to_remove", products: ["Polo básico", "Gorra"] })).toBe("Qual você quer remover: Polo básico ou Gorra?");
    expect(es({ kind: "which_product_for_value", value: "rojo", products: ["Gorra", "Short"] })).toBe("¿Cuál quieres en rojo: Gorra o Short?");
    expect(pt({ kind: "which_product_for_value", value: "rojo", products: ["Gorra", "Short"] })).toBe("Qual você quer em rojo: Gorra ou Short?");
    expect(es({ kind: "another_of_which" })).toBe("¿De cuál producto quieres otro?");
    expect(pt({ kind: "another_of_which" })).toBe("De qual produto você quer mais um?");
    expect(es({ kind: "photo_product_name" })).toBe("¿Me dices el nombre del producto de la foto?");
    expect(pt({ kind: "photo_product_name" })).toBe("Pode me dizer o nome do produto da foto?");
    expect(es({ kind: "product_gone", product: "Gorra" })).toBe("Ya no tenemos Gorra. ¿Te muestro otra opción?");
    expect(pt({ kind: "product_gone", product: "Gorra" })).toBe("Não temos mais Gorra. Quer ver outra opção?");
  });

  test("lowercases an attribute name the catalog saved capitalized and puts no article before a product", () => {
    expect(es({ kind: "which_variant", product: "Gorra trucker", attribute: "Talla", values: ["S"] })).toBe("Gorra trucker: ¿en qué talla? Tenemos S.");
    expect(pt({ kind: "which_variant", product: "Casaca jean", attribute: "Color", values: [] })).toBe("Casaca jean: em qual cor?");
  });

  test("never writes a question that claims how many are in stock", () => {
    const claims = /hay |stock|estoque|disponible|disponível|quedan|sobram/i;
    const questions: SuggestedQuestion[] = (["es", "pt"] as const).flatMap((language) => [
      { language, kind: "which_variant", product: "Polo", attribute: "talla", values: ["S", "M"] },
      { language, kind: "which_product", products: ["A", "B"] },
      { language, kind: "variant_unavailable", product: "Polo", asked: "XL", attribute: "talla", values: ["S"] },
      { language, kind: "variant_for_which", attribute: "Talla", value: "M", products: ["A"] },
      { language, kind: "which_item_to_remove", products: ["A"] },
      { language, kind: "which_product_for_value", value: "M", products: ["A"] },
      { language, kind: "another_of_which" },
      { language, kind: "photo_product_name" },
      { language, kind: "product_gone", product: "Gorra" },
    ] as SuggestedQuestion[]);
    for (const question of questions) expect(suggestedQuestionText(question)).not.toMatch(claims);
  });
});
