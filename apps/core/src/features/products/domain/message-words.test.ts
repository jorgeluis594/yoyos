import { describe, expect, test } from "vitest";
import { searchedWords, searchedWordCap, defaultTextMatchLimits } from "@core/src/features/products/domain/message-words";

describe("searchedWords", () => {
  test("keeps the distinct words of at least three characters without accents or case", () => {
    expect(searchedWords("Quiero el POLERÓN, el poleron y la gorra!")).toEqual(["poleron", "quiero", "gorra"]);
  });

  test("returns no words for a greeting made of short words", () => {
    expect(searchedWords("hi, ok :) 12")).toEqual([]);
  });

  test("keeps the longest distinct words first when the cap applies, ties by first appearance", () => {
    expect(searchedWords("quiero la polera con capucha oversize negra en talla M")).toEqual(["oversize", "capucha", "quiero", "polera", "negra", "talla", "con"]);
  });

  test("splits on every run of non-letter, non-digit characters and keeps digits", () => {
    expect(searchedWords("polo-básico/talla_M 2x1 (66)")).toEqual(["basico", "talla", "polo", "2x1"]);
  });
});

describe("searchedWordCap", () => {
  const cap = (products: number) => searchedWordCap(products, defaultTextMatchLimits);

  test("searches 30 words at 500 products, 12 at 2,000, 5 at 5,000 and 3 above 8,333", () => {
    expect([cap(0), cap(1), cap(500), cap(2_000), cap(5_000), cap(8_333), cap(8_334), cap(10_000), cap(30_000)]).toEqual([30, 30, 30, 12, 5, 3, 3, 3, 3]);
  });
});
