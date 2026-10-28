import { expect, test } from "vitest";
import { isVariantOnlyText } from "@core/src/features/orders/domain/variant-only-text";

test("a size, a color or both, with articles, wanting or courtesy words, only names a variant", () => {
  expect(["en XS", "celeste", "Celestitas porfa", "la prefiero en talla XS", "me gustaria en azul marino", "lo necesito talla 38", "XL o XXL", "la quiero en Única"]
    .filter((text) => !isVariantOnlyText(text, ["Única"]))).toEqual([]);
});

test("a value of an open order item that no list has also names a variant", () => {
  expect(isVariantOnlyText("en jaspe", [])).toBe(false);
  expect(isVariantOnlyText("en jaspe", ["Jaspe", "S"])).toBe(true);
});

test("a change verb, a product, a quantity, a question or no value at all leaves the text to the models", () => {
  expect(["mejor en XS", "cámbialo a celeste", "pásala a XS", "la casaca en XS", "2 en XS", "XS x2", "hay en XS?", "38", "quiero", "gracias", "claro"]
    .filter((text) => isVariantOnlyText(text, ["38"]))).toEqual([]);
});
