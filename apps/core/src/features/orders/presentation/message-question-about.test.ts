import { describe, expect, test } from "vitest";
import { questionAbout } from "@core/src/features/orders/presentation/message-question-routes";

describe("questionAbout", () => {
  test("names the product of a question about one product", () => {
    expect(questionAbout({ language: "es", kind: "which_variant", product: "Polo básico", attribute: "Talla", values: ["S", "M"] })).toBe("Polo básico");
  });

  test("joins the products of a question about several", () => {
    expect(questionAbout({ language: "pt", kind: "which_product", products: ["Polo básico", "Polo rojo"] })).toBe("Polo básico, Polo rojo");
  });

  test("is empty when the question names no product", () => {
    expect(questionAbout({ language: "es", kind: "another_of_which" })).toBe("");
  });
});
