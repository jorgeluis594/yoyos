import assert from "node:assert/strict";
import test from "node:test";
import { fitLabelLines, fitLabelWords } from "./label-text.ts";

const measure = (text) => Array.from(text).length;

test("fitLabelLines keeps wrapping by character for product labels", () => {
  assert.deepEqual(fitLabelLines("Jorge Gonzalez", 8, measure, 5, false), ["Jorge Go", "nzalez"]);
  assert.deepEqual(fitLabelLines("abcdefghij", 4, measure, 2, true), ["abcd", "efg…"]);
});

test("fitLabelWords breaks at spaces and drops the break spaces", () => {
  assert.deepEqual(fitLabelWords("Jorge Gonzalez Ramírez", 17, measure), ["Jorge Gonzalez", "Ramírez"]);
  assert.deepEqual(fitLabelWords("a  b", 1, measure), ["a", "b"]);
});

test("fitLabelWords keeps hyphens and periods inside words", () => {
  assert.deepEqual(fitLabelWords("Mz. B Lote-4", 8, measure), ["Mz. B", "Lote-4"]);
});

test("fitLabelWords splits a long word by character without hyphen and continues after the last fragment", () => {
  assert.deepEqual(fitLabelWords("Av abcdefghij Sur", 4, measure), ["Av", "abcd", "efgh", "ij", "Sur"]);
  assert.deepEqual(fitLabelWords("abcdefg hi", 4, measure), ["abcd", "efg", "hi"]);
  assert.deepEqual(fitLabelWords("abcdef gh", 4, measure), ["abcd", "ef", "gh"]);
});

test("fitLabelWords keeps newlines and rejects blank lines or characters wider than the line", () => {
  assert.deepEqual(fitLabelWords("Mz A\nLote 4", 10, measure), ["Mz A", "Lote 4"]);
  assert.equal(fitLabelWords("a\n\nb", 10, measure), null);
  assert.equal(fitLabelWords("abc", 0.5, measure), null);
});
