import { describe, expect, test } from "vitest";
import { suggestedQuestionText } from "@core/src/features/orders/presentation/suggested-question-texts";
import type { SuggestedQuestion } from "@core/src/features/orders/domain/suggested-question";

const es = <Q extends Omit<SuggestedQuestion, "language">>(question: Q) => suggestedQuestionText({ language: "es", ...question } as SuggestedQuestion);
const pt = <Q extends Omit<SuggestedQuestion, "language">>(question: Q) => suggestedQuestionText({ language: "pt", ...question } as SuggestedQuestion);

describe("suggestedQuestionText", () => {
  test("writes the which-variant question with the values in Spanish and Portuguese", () => {
    const question = { kind: "which_variant", product: "Polo básico", attribute: "talla", values: ["S", "M", "L"] } as const;
    expect(es(question)).toBe("¿En qué talla quieres el Polo básico: S, M o L?");
    expect(pt(question)).toBe("Em qual tamanho você quer o Polo básico: S, M ou L?");
  });

  test("writes the which-variant question without values when the attribute has more than three", () => {
    const question = { kind: "which_variant", product: "Polo básico", attribute: "talla", values: [] } as const;
    expect(es(question)).toBe("¿En qué talla quieres el Polo básico?");
    expect(pt(question)).toBe("Em qual tamanho você quer o Polo básico?");
  });

  test("writes the question in Portuguese when the buyer wrote in Portuguese", () => {
    expect(pt({ kind: "which_product", products: ["Polo básico", "Polo premium"] })).toBe("Qual destes você quer: Polo básico ou Polo premium?");
    expect(es({ kind: "which_product", products: ["Polo básico", "Polo premium", "Gorra"] })).toBe("¿Cuál de estos quieres: Polo básico, Polo premium o Gorra?");
  });

  test("writes the rest of the kinds in both languages", () => {
    expect(es({ kind: "variant_unavailable", product: "Polo básico", asked: "XL", attribute: "talla", values: ["S", "M"] })).toBe("El Polo básico no viene en XL. ¿En qué talla lo quieres: S o M?");
    expect(pt({ kind: "variant_unavailable", product: "Polo básico", asked: "XL", attribute: "talla", values: [] })).toBe("O Polo básico não vem em XL. Em qual tamanho você quer?");
    expect(es({ kind: "variant_for_which", value: "M", products: ["Polo básico", "Gorra"] })).toBe("¿De cuál lo quieres en M: Polo básico o Gorra?");
    expect(pt({ kind: "variant_for_which", value: "M", products: ["Polo básico", "Gorra"] })).toBe("De qual você quer em M: Polo básico ou Gorra?");
    expect(es({ kind: "which_item_to_remove", products: ["Polo básico", "Gorra"] })).toBe("¿Cuál quieres quitar: Polo básico o Gorra?");
    expect(pt({ kind: "which_item_to_remove", products: ["Polo básico", "Gorra"] })).toBe("Qual você quer remover: Polo básico ou Gorra?");
    expect(es({ kind: "which_product_for_value", value: "rojo", products: ["Gorra", "Short"] })).toBe("¿En cuál lo quieres en rojo: Gorra o Short?");
    expect(pt({ kind: "which_product_for_value", value: "rojo", products: ["Gorra", "Short"] })).toBe("Em qual você quer em rojo: Gorra ou Short?");
    expect(es({ kind: "another_of_which" })).toBe("¿Otro de cuál producto?");
    expect(pt({ kind: "another_of_which" })).toBe("Mais um de qual produto?");
    expect(es({ kind: "photo_product_name" })).toBe("¿Cómo se llama el producto de la foto?");
    expect(pt({ kind: "photo_product_name" })).toBe("Qual é o nome do produto da foto?");
    expect(es({ kind: "product_gone", product: "Gorra" })).toBe("¿Quieres ver otro producto en lugar de Gorra?");
    expect(pt({ kind: "product_gone", product: "Gorra" })).toBe("Quer ver outro produto no lugar de Gorra?");
  });

  test("never writes a question that claims stock", () => {
    const claims = /tenemos|tem em estoque|temos|hay |stock|estoque|disponible|disponível|quedan|sobram/i;
    const questions: SuggestedQuestion[] = (["es", "pt"] as const).flatMap((language) => [
      { language, kind: "which_variant", product: "Polo", attribute: "talla", values: ["S", "M"] },
      { language, kind: "which_product", products: ["A", "B"] },
      { language, kind: "variant_unavailable", product: "Polo", asked: "XL", attribute: "talla", values: ["S"] },
      { language, kind: "variant_for_which", value: "M", products: ["A"] },
      { language, kind: "which_item_to_remove", products: ["A"] },
      { language, kind: "which_product_for_value", value: "M", products: ["A"] },
      { language, kind: "another_of_which" },
      { language, kind: "photo_product_name" },
      { language, kind: "product_gone", product: "Gorra" },
    ] as SuggestedQuestion[]);
    for (const question of questions) expect(suggestedQuestionText(question)).not.toMatch(claims);
  });
});
