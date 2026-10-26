import assert from "node:assert/strict";
import { test } from "node:test";
import { combinationLabel } from "./product-variants.ts";

const options = [
  { id: "o-color", name: "Color", values: [{ id: "v-negro", name: "Negro" }, { id: "v-azul", name: "Azul" }] },
  { id: "o-talla", name: "Talla", values: [{ id: "v-l", name: "L" }, { id: "v-m", name: "M" }] },
];

test("combinationLabel joins values in saved option order with ' / '", () => {
  assert.equal(combinationLabel(options, [{ optionId: "o-talla", valueId: "v-l" }, { optionId: "o-color", valueId: "v-azul" }]), "Azul / L");
  assert.equal(combinationLabel(options, { "o-talla": "v-m", "o-color": "v-negro" }), "Negro / M");
  assert.equal(combinationLabel([...options].reverse(), { "o-talla": "v-m", "o-color": "v-negro" }), "M / Negro");
});

test("combinationLabel is empty for a product without options and skips unknown values", () => {
  assert.equal(combinationLabel([], []), "");
  assert.equal(combinationLabel(options, [{ optionId: "o-color", valueId: "v-azul" }, { optionId: "o-talla", valueId: "missing" }]), "Azul");
});
