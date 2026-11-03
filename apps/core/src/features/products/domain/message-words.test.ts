import { describe, expect, test } from "vitest";
import { allocateMentionWords, defaultMentionPairBudget, searchedWords, searchedWordCap, defaultTextMatchLimits } from "@core/src/features/products/domain/message-words";

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

describe("allocateMentionWords", () => {
  const limits = { pairBudget: defaultMentionPairBudget, minWords: 3, maxWords: 30 };
  const tenMentions = Array.from({ length: 10 }, (_, index) => `polera modelo${index} negra talla grande`);
  const total = (words: readonly (readonly string[])[]) => words.reduce((sum, list) => sum + list.length, 0);

  test("gives every mention one word before any mention gets a second", () => {
    const words = allocateMentionWords(tenMentions, 10_000, limits);
    expect(words.map((list) => list.length)).toEqual(Array(10).fill(1));
    expect(words[0]).toEqual(["modelo0"]);
    expect(total(allocateMentionWords(tenMentions, 5_000, limits))).toBe(20);
    expect(allocateMentionWords(tenMentions, 5_000, limits).map((list) => list.length)).toEqual(Array(10).fill(2));
  });

  test("shares the pair budget across a message's mentions and never exceeds it above the three-word floor", () => {
    for (const products of [1, 100, 2_500, 10_000, 33_333]) {
      const words = allocateMentionWords(tenMentions, products, limits);
      expect(total(words) * products).toBeLessThanOrEqual(limits.pairBudget);
    }
    expect(total(allocateMentionWords(tenMentions, 2_500, limits))).toBe(40);
    expect(total(allocateMentionWords(["polera negra con capucha"], 2_500, limits))).toBe(4);
  });

  test("leaves a mention without words not identified when the catalog allows fewer words than mentions", () => {
    const words = allocateMentionWords(tenMentions, 50_000, limits);
    expect(total(words)).toBe(3);
    expect(words.map((list) => list.length)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("gives no mention more than the maximum and ignores mentions without words", () => {
    const long = Array.from({ length: 40 }, (_, index) => `palabra${index}`).join(" ");
    const words = allocateMentionWords([long, "si", "gorra roja"], 100, { ...limits, maxWords: 30 });
    expect(words[0]).toHaveLength(30);
    expect(words[1]).toEqual([]);
    expect(words[2]).toEqual(["gorra", "roja"]);
  });
});
