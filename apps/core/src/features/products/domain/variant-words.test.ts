import { expect, test } from "vitest";
import { baseFormsOf, valueWordOf } from "@core/src/features/products/domain/variant-words";

const values = new Set(["rojo", "negro", "blanco", "gris", "verde", "marron", "azul", "celeste", "cafe", "l", "m", "unica"]);

test("plural, feminine and diminutive forms name their value word", () => {
  expect(["rojas", "Rojitas", "negras", "blanquita", "grises", "verdecito", "marrones", "azules", "celestes", "cafecito", "ROJO"].map((word) => valueWordOf(word, values)))
    .toEqual(["rojo", "rojo", "negro", "blanco", "gris", "verde", "marron", "azul", "celeste", "cafe", "rojo"]);
});

test("words that name no value, or short words, stay unnamed", () => {
  expect(valueWordOf("las", values)).toBeNull();
  expect(valueWordOf("es", values)).toBeNull();
  expect(valueWordOf("rosadas", values)).toBeNull();
  expect(baseFormsOf("ls")).toEqual(["ls"]);
});

test("a word whose forms name two value words names none", () => {
  expect(valueWordOf("rojas", new Set(["roja", "rojo"]))).toBeNull();
  expect(valueWordOf("roja", new Set(["roja", "rojo"]))).toBe("roja");
});
