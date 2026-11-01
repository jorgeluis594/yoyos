import { describe, expect, test } from "vitest";
import { productNameFolds, productNameKey } from "@core/src/features/products/domain/product-name-key";

describe("productNameKey", () => {
  test("is the same for a name written with other case or without accents", () => {
    expect(productNameKey("Polo Básico")).toBe(productNameKey("polo basico"));
    expect(productNameKey("POLO BÁSICO")).toBe("polo basico");
  });

  test("removes exactly the accents of the folds and keeps every other character", () => {
    expect(productNameKey("áàâäãéèêëíìîïóòôöõúùûüñç")).toBe("aaaaaeeeeiiiiooooouuuunc");
    expect(productNameKey("Camisa-ñandú 2x1 ß")).toBe("camisa-nandu 2x1 ß");
  });

  test("keeps the folds as two strings of the same length for SQL translate", () => {
    expect([...productNameFolds.from]).toHaveLength([...productNameFolds.to].length);
  });

  test("tells apart names that differ in more than accents or case", () => {
    expect(productNameKey("Polo básico")).not.toBe(productNameKey("Polo basico negro"));
  });
});
