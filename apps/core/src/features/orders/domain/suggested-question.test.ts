import { describe, expect, test } from "vitest";
import { suggestedQuestionSchema } from "@core/src/features/orders/domain/suggested-question";

const questions = [
  { language: "es", kind: "which_variant", product: "Polera", attribute: "Talla", values: ["S", "M", "L"] },
  { language: "pt", kind: "which_variant", product: "Camisa", attribute: "Tamanho", values: [] },
  { language: "es", kind: "which_product", products: ["Polera roja", "Polera azul"] },
  { language: "es", kind: "variant_unavailable", product: "Polera", asked: "XL", attribute: "Talla", values: ["S"] },
  { language: "pt", kind: "variant_for_which", value: "M", products: ["Polera", "Short"] },
  { language: "es", kind: "which_item_to_remove", products: ["Polera", "Short"] },
  { language: "es", kind: "which_product_for_value", value: "rojo", products: ["Polera", "Short"] },
  { language: "es", kind: "another_of_which" },
  { language: "pt", kind: "photo_product_name" },
  { language: "es", kind: "product_gone", product: "Polera" },
] as const;

describe("suggestedQuestionSchema", () => {
  test.each(questions)("round-trips $kind in $language", (question) => {
    expect(suggestedQuestionSchema.parse(JSON.parse(JSON.stringify(question)))).toEqual(question);
  });

  test.each([
    ["an unknown kind", { language: "es", kind: "free_text", text: "hola" }],
    ["an unsupported language", { language: "en", kind: "photo_product_name" }],
    ["a missing language", { kind: "photo_product_name" }],
    ["more than three values", { language: "es", kind: "which_variant", product: "Polera", attribute: "Talla", values: ["S", "M", "L", "XL"] }],
    ["one product for which_product", { language: "es", kind: "which_product", products: ["Polera"] }],
    ["five products for which_product", { language: "es", kind: "which_product", products: ["a", "b", "c", "d", "e"] }],
    ["an empty product name", { language: "es", kind: "product_gone", product: "" }],
    ["an extra field", { language: "es", kind: "another_of_which", text: "hola" }],
  ])("rejects %s", (_title, stored) => {
    expect(suggestedQuestionSchema.safeParse(stored).success).toBe(false);
  });
});
