import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductRequestSchema, saveProductRequestSchema } from "./contracts/products.ts";
import {
  addCombination, addOption, addValue, applyBulk, buildCreateProductBody, buildSaveProductBody, combinationLabel, copiedStockNotice, createDraft,
  draftFromProduct, hiddenSelectedCount, setValueForExistingVariants, inactiveSourceCount, isChipActive, moveOption, moveValue, orderedRows, removalOf, removeOption, removeRow,
  removeValue, renameOption, renameValue, rowLabel, setRow, toggleAll, toggleChip, uncreatedCombinations, uncreatedCount, undoRemoveRow,
  undoRemoveValue, variantCounter,
} from "./product-variants.ts";

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

// Fixtures. Ids are real UUIDs because the bodies are parsed with the request schemas.
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { sku: null, salePrice: 39.9, purchasePrice: 20, stock: 4 };
const optionSpec = (n, name, values) => ({ id: uuid(n * 100), name, values: values.map((valueName, index) => ({ id: uuid(n * 100 + index + 1), name: valueName })) });
const must = (edit) => {
  assert.equal(edit.success, true, JSON.stringify(edit));
  return edit.data;
};
const dropRow = (draft, ref) => must(removeRow(draft, ref));
const labels = (draft) => orderedRows(draft).map((row) => rowLabel(draft, row));
const rowOf = (draft, label) => {
  const row = orderedRows(draft).find((candidate) => rowLabel(draft, candidate) === label);
  assert.ok(row, `row ${label}`);
  return row;
};
const money = (amount) => ({ amount, currency: "PEN" });

/** A saved product: `variants` lists the combinations by value name; the rest of the fields are overridable. */
function savedProduct(optionList, variants, overrides = {}) {
  const valueId = (optionName, valueName) => optionList.find((option) => option.name === optionName).values.find((value) => value.name === valueName).id;
  return {
    id: uuid(1), name: "Polo", description: null, imageId: null, currency: "PEN", qrCode: uuid(2), createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z", structureVersion: 3, options: optionList,
    variants: variants.map((entry, index) => ({
      id: uuid(5000 + index),
      combination: optionList.map((option) => ({ optionId: option.id, valueId: valueId(option.name, entry.values[optionList.indexOf(option)]) })),
      sku: null, salePrice: money(entry.price ?? 30), purchasePrice: money(15), qrCode: uuid(6000 + index), status: entry.status ?? "active",
      stock: entry.stock ?? 0, hasOrders: entry.hasOrders ?? false,
    })),
    ...overrides,
  };
}
const polo = () => {
  const talla = optionSpec(1, "Talla", ["S", "M"]);
  const color = optionSpec(2, "Color", ["Negro", "Azul"]);
  return { talla, color };
};
const fullPolo = (customize = {}) => {
  const { talla, color } = polo();
  return savedProduct([talla, color], [
    { values: ["S", "Negro"], ...customize["S / Negro"] }, { values: ["S", "Azul"], ...customize["S / Azul"] },
    { values: ["M", "Negro"], ...customize["M / Negro"] }, { values: ["M", "Azul"], ...customize["M / Azul"] },
  ]);
};
/** Talla S/M/L × Color Negro/Azul on a new product. */
function newPolo() {
  let draft = createDraft(base);
  draft = must(addOption(draft, optionSpec(1, "Talla", ["S", "M", "L"])));
  return must(addOption(draft, optionSpec(2, "Color", ["Negro", "Azul"])));
}

test("generates combinations in option and value order", () => {
  const draft = newPolo();
  assert.deepEqual(labels(draft), ["S / Negro", "S / Azul", "M / Negro", "M / Azul", "L / Negro", "L / Azul"]);
  for (const row of orderedRows(draft)) {
    assert.deepEqual([row.salePrice, row.purchasePrice, row.stock, row.sku, row.id, row.status], [39.9, 20, 4, null, null, "active"]);
  }
  assert.equal(copiedStockNotice(draft), 4);
  assert.equal(copiedStockNotice(setRow(draft, rowOf(draft, "M / Azul").ref, { stock: 2 })), null);
  assert.equal(copiedStockNotice(createDraft({ ...base, stock: 0 })), null);
});

test("adding a value creates only the combinations that contain it and skips removed ones", () => {
  let draft = newPolo();
  draft = must(removeValue(draft, uuid(202)));
  draft = must(addValue(draft, uuid(100), { id: uuid(900), name: "XL" }));
  const added = orderedRows(draft).filter((row) => !labels(draft).slice(0, 6).includes(rowLabel(draft, row)));
  assert.deepEqual(added.map((row) => rowLabel(draft, row)), ["XL / Negro"]);
  assert.equal(orderedRows(draft).length, 7);
  assert.equal(removalOf(draft, rowOf(draft, "S / Azul")), "value");
});

test("adding an option gives its first value to existing combinations and copies prices to the new ones", () => {
  let draft = createDraft(base);
  draft = must(addOption(draft, optionSpec(1, "Talla", ["S", "M"])));
  const small = rowOf(draft, "S");
  draft = setRow(draft, small.ref, { sku: "POLO-S", salePrice: 50, purchasePrice: 25 });
  draft = must(addOption(draft, optionSpec(2, "Color", ["Negro", "Azul"])));
  assert.deepEqual(labels(draft), ["S / Negro", "S / Azul", "M / Negro", "M / Azul"]);
  assert.deepEqual(
    [rowOf(draft, "S / Negro").ref, rowOf(draft, "S / Negro").sku, rowOf(draft, "S / Negro").salePrice],
    [small.ref, "POLO-S", 50],
  );
  const copy = rowOf(draft, "S / Azul");
  assert.deepEqual([copy.sku, copy.salePrice, copy.purchasePrice, copy.stock], [null, 50, 25, 4]);
});

test("a new combination of a saved product copies prices from the first variant sharing the other values, preferring an active one", () => {
  const { talla, color } = polo();
  const product = savedProduct([talla, color], [
    { values: ["S", "Negro"], status: "inactive", price: 10 }, { values: ["S", "Azul"], price: 30 },
    { values: ["M", "Negro"], price: 20 }, { values: ["M", "Azul"], status: "inactive", price: 40 },
  ]);
  let draft = must(addValue(draftFromProduct(product), talla.id, { id: uuid(900), name: "XL" }));
  assert.deepEqual([rowOf(draft, "XL / Negro").salePrice, rowOf(draft, "XL / Negro").stock, rowOf(draft, "XL / Negro").id], [20, 0, null]);
  assert.equal(rowOf(draft, "XL / Azul").salePrice, 30);
  assert.equal(inactiveSourceCount(draft), 0);

  const allInactive = savedProduct([talla, color], [
    { values: ["S", "Negro"], status: "inactive", price: 10 }, { values: ["M", "Negro"], status: "inactive", price: 20 },
  ]);
  draft = must(addValue(draftFromProduct(allInactive), talla.id, { id: uuid(900), name: "XL" }));
  assert.equal(rowOf(draft, "XL / Negro").salePrice, 10);
  assert.equal(rowOf(draft, "XL / Negro").status, "active");
});

test("marking a value marks its rows and undoing it restores rows marked by themselves", () => {
  let draft = createDraft(base);
  draft = must(addOption(draft, optionSpec(1, "Talla", ["S", "M", "L"])));
  const small = rowOf(draft, "S").ref;
  draft = dropRow(draft, small);
  assert.equal(removalOf(draft, rowOf(draft, "S")), "self");
  draft = must(removeValue(draft, uuid(101)));
  assert.equal(removalOf(draft, rowOf(draft, "S")), "value");
  draft = undoRemoveValue(draft, uuid(101));
  assert.equal(removalOf(draft, rowOf(draft, "S")), "self");
  draft = must(removeValue(draft, uuid(102)));
  assert.equal(removalOf(draft, rowOf(draft, "M")), "value");
  draft = undoRemoveValue(draft, uuid(102));
  assert.equal(removalOf(draft, rowOf(draft, "M")), null);
  const restored = undoRemoveRow(draft, small);
  assert.equal(removalOf(restored, rowOf(restored, "S")), null);
});

test("the counter excludes marked rows and the limit check reports current plus new", () => {
  let draft = newPolo();
  draft = setRow(draft, rowOf(draft, "S / Azul").ref, { salePrice: 1 });
  draft = dropRow(draft, rowOf(draft, "M / Azul").ref);
  assert.deepEqual(variantCounter(draft), { count: 5, inactive: 0, maximum: 100 });

  const third = addOption(draft, optionSpec(3, "Manga", ["Corta", "Larga", "Sin", "Con"]));
  assert.equal(third.success, true);
  // 5 × 6 × 4 = 120 from scratch.
  let wide = createDraft(base);
  wide = must(addOption(wide, optionSpec(1, "A", ["1", "2", "3", "4", "5"])));
  wide = must(addOption(wide, optionSpec(2, "B", ["1", "2", "3", "4", "5", "6"])));
  const over = addOption(wide, optionSpec(3, "C", ["1", "2", "3", "4"]));
  assert.deepEqual([over.success, over.error.code, over.error.projected, over.error.maximum], [false, "TOO_MANY_VARIANTS", 120, 100]);

  // 98 saved plus 6 new.
  const a = optionSpec(1, "A", Array.from({ length: 17 }, (_, index) => `a${index}`));
  const b = optionSpec(2, "B", ["b0", "b1", "b2", "b3", "b4", "b5"]);
  const combos = a.values.flatMap((av) => b.values.map((bv) => [av.name, bv.name])).slice(0, 98);
  const saved = draftFromProduct(savedProduct([a, b], combos.map((values) => ({ values }))));
  assert.equal(variantCounter(saved).count, 98);
  const tooMany = addValue(saved, b.id, { id: uuid(900), name: "b6" });
  assert.deepEqual([tooMany.success, tooMany.error.code, tooMany.error.projected], [false, "TOO_MANY_VARIANTS", 115]);
  const sixNew = addValue(saved, a.id, { id: uuid(901), name: "a17" });
  assert.deepEqual([sixNew.success, sixNew.error.code, sixNew.error.projected, sixNew.error.maximum], [false, "TOO_MANY_VARIANTS", 104, 100]);
});

test("the option and value limits are checked", () => {
  let draft = newPolo();
  draft = must(addOption(draft, optionSpec(3, "Manga", ["Corta"])));
  assert.equal(addOption(draft, optionSpec(4, "Cuello", ["Redondo"])).error.code, "TOO_MANY_OPTIONS");
  let many = createDraft(base);
  many = must(addOption(many, optionSpec(1, "Talla", Array.from({ length: 30 }, (_, index) => `t${index}`))));
  assert.equal(addValue(many, uuid(100), { id: uuid(900), name: "t30" }).error.code, "TOO_MANY_VALUES");
  assert.equal(addOption(createDraft(base), optionSpec(1, "Talla", [])).error.code, "OPTION_WITHOUT_VALUES");
});

test("renaming and moving options and values keeps what was edited", () => {
  let draft = newPolo();
  const target = rowOf(draft, "L / Negro");
  draft = setRow(draft, target.ref, { salePrice: 42.9, sku: "POLO-L-N" });
  draft = renameValue(draft, uuid(201), "Negro carbón");
  draft = moveOption(draft, uuid(200), 0);
  draft = moveValue(draft, uuid(100), uuid(103), 0);
  assert.deepEqual(labels(draft).slice(0, 3), ["Negro carbón / L", "Negro carbón / S", "Negro carbón / M"]);
  const kept = rowOf(draft, "Negro carbón / L");
  assert.deepEqual([kept.ref, kept.salePrice, kept.sku], [target.ref, 42.9, "POLO-L-N"]);
  assert.equal(renameOption(draft, uuid(200), "Tono").options[0].name, "Tono");
});

test("adding Manga and then deleting it leaves the Corta combinations with their edits", () => {
  const product = fullPolo();
  let draft = draftFromProduct(product);
  const edited = rowOf(draft, "S / Negro");
  draft = setRow(draft, edited.ref, { salePrice: 45, sku: "S-N" });
  draft = must(addOption(draft, optionSpec(3, "Manga", ["Corta", "Larga"])));
  assert.equal(orderedRows(draft).length, 8);
  draft = must(removeOption(draft, uuid(300)));
  assert.equal(variantCounter(draft).count, 4);
  assert.deepEqual(labels(draft).filter((label) => removalOf(draft, rowOf(draft, label)) === null), ["S / Negro / Corta", "S / Azul / Corta", "M / Negro / Corta", "M / Azul / Corta"]);
  const body = buildSaveProductBody(draft, { structureVersion: 3, name: "Polo", description: null, imageId: null });
  const parsed = saveProductRequestSchema.parse(body);
  assert.deepEqual(parsed.options.map((option) => option.name), ["Talla", "Color"]);
  assert.deepEqual([parsed.newVariants.length, parsed.deletedVariantIds.length], [0, 0]);
  assert.deepEqual(parsed.variants, [{ id: edited.id, sku: "S-N", salePrice: 45, purchasePrice: 15 }]);
});

test("the body for a saved product that adds Manga carries valueForExistingVariants", () => {
  const draft = must(addOption(draftFromProduct(fullPolo({ "S / Azul": { status: "inactive" } })), optionSpec(3, "Manga", ["Corta", "Larga"])));
  const body = saveProductRequestSchema.parse(buildSaveProductBody(draft, { structureVersion: 3, name: "Polo", description: "x", imageId: null }));
  const manga = body.options[2];
  assert.deepEqual([manga.name, manga.valueForExistingVariants, manga.values.map((value) => value.name)], ["Manga", uuid(301), ["Corta", "Larga"]]);
  assert.equal(body.options[0].valueForExistingVariants, undefined);
  assert.equal(body.newVariants.length, 4);
  assert.ok(body.newVariants.every((variant) => variant.values.length === 3 && variant.initialStock === 0));
  assert.equal(body.structureVersion, 3);
});

test("a new combination copied from an inactive variant is flagged so the table warns it will go on sale", () => {
  const draft = must(addOption(draftFromProduct(fullPolo({ "S / Azul": { status: "inactive" } })), optionSpec(3, "Manga", ["Corta", "Larga"])));
  assert.equal(inactiveSourceCount(draft), 1);
  assert.equal(rowOf(draft, "S / Azul / Larga").copiedFromInactive, true);
  assert.equal(rowOf(draft, "S / Azul / Larga").status, "active");
  assert.equal(rowOf(draft, "S / Negro / Larga").copiedFromInactive, false);
  assert.equal(inactiveSourceCount(dropRow(draft, rowOf(draft, "S / Azul / Larga").ref)), 0);
  assert.deepEqual(variantCounter(draft), { count: 8, inactive: 1, maximum: 100 });
});

test("with the Azul filter active the L chip selects only L / Azul", () => {
  let draft = newPolo();
  draft = setRow(draft, rowOf(draft, "M / Negro").ref, { stock: 1 });
  const azul = uuid(202);
  const lChip = uuid(103);
  const selected = toggleChip(draft, [], lChip, azul);
  assert.deepEqual(selected, [rowOf(draft, "L / Azul").ref]);
  assert.equal(isChipActive(draft, selected, lChip, azul), true);
  assert.deepEqual(toggleChip(draft, selected, lChip, azul), []);
  assert.equal(toggleChip(draft, [], lChip, null).length, 2);
  assert.equal(toggleAll(draft, [], azul).length, 3);
  assert.equal(toggleAll(draft, toggleAll(draft, [], azul), azul).length, 0);
  assert.equal(hiddenSelectedCount(draft, toggleAll(draft, [], null), azul), 3);
});

test("chips and Todas never select inactive or marked rows", () => {
  const draft = draftFromProduct(fullPolo({ "S / Negro": { status: "inactive" } }));
  const marked = must(addValue(draft, uuid(100), { id: uuid(900), name: "XL" }));
  const withMarked = dropRow(marked, rowOf(marked, "XL / Negro").ref);
  const all = toggleAll(withMarked, [], null);
  assert.equal(all.length, 4);
  assert.ok(!all.includes(rowOf(withMarked, "S / Negro").ref) && !all.includes(rowOf(withMarked, "XL / Negro").ref));
});

test("bulk edits reach the selection, and stock only reaches new rows", () => {
  let draft = must(addValue(draftFromProduct(fullPolo()), uuid(100), { id: uuid(900), name: "XL" }));
  const selected = orderedRows(draft).map((row) => row.ref);
  const priced = applyBulk(draft, selected, { salePrice: 42.9 });
  assert.equal(priced.applied, 6);
  assert.ok(orderedRows(priced.draft).every((row) => row.salePrice === 42.9));
  const stocked = applyBulk(draft, selected, { stock: 7 });
  assert.equal(stocked.applied, 2);
  assert.deepEqual(orderedRows(stocked.draft).map((row) => row.stock), [0, 0, 0, 0, 7, 7]);
});

test("lists combinations not created in saved order and adding one respects the limit", () => {
  const { talla, color } = polo();
  const product = savedProduct([talla, color], [{ values: ["S", "Negro"], price: 11 }, { values: ["M", "Azul"], price: 22 }]);
  let draft = draftFromProduct(product);
  assert.equal(uncreatedCount(draft), 2);
  const listed = uncreatedCombinations(draft);
  assert.deepEqual(listed.items.map((item) => item.label), ["S / Azul", "M / Negro"]);
  assert.equal(listed.hasMore, false);
  draft = must(addCombination(draft, listed.items[0].combination));
  assert.equal(uncreatedCount(draft), 1);
  assert.deepEqual([rowOf(draft, "S / Azul").salePrice, rowOf(draft, "S / Azul").stock, rowOf(draft, "S / Azul").id], [11, 0, null]);
  assert.equal(addCombination(draft, listed.items[0].combination).success, false);

  const a = optionSpec(1, "A", Array.from({ length: 10 }, (_, index) => `a${index}`));
  const b = optionSpec(2, "B", Array.from({ length: 11 }, (_, index) => `b${index}`));
  const full = draftFromProduct(savedProduct([a, b], a.values.flatMap((av) => b.values.map((bv) => ({ values: [av.name, bv.name] }))).slice(0, 100)));
  const atLimit = addCombination(full, uncreatedCombinations(full).items[0].combination);
  assert.deepEqual([atLimit.success, atLimit.error.code, atLimit.error.projected], [false, "TOO_MANY_VARIANTS", 101]);
});

test("with 30 × 30 × 30 values and 100 saved variants the counter and limit check use arithmetic and the uncreated list is paged", () => {
  const names = (prefix) => Array.from({ length: 30 }, (_, index) => `${prefix}${index}`);
  const [a, b, c] = [optionSpec(1, "A", names("a")), optionSpec(2, "B", names("b")), optionSpec(3, "C", names("c"))];
  const saved = Array.from({ length: 100 }, (_, index) => ({ values: [`a${Math.floor(index / 30)}`, `b${index % 30}`, "c0"] }));
  const draft = draftFromProduct(savedProduct([a, b, c], saved));
  const started = Date.now();
  assert.equal(variantCounter(draft).count, 100);
  assert.equal(uncreatedCount(draft), 27000 - 100);
  const first = uncreatedCombinations(draft);
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  const second = uncreatedCombinations(draft, { offset: 50 });
  assert.notEqual(second.items[0].label, first.items[0].label);
  assert.equal(addValue(draft, a.id, { id: uuid(900), name: "a30" }).error.code, "TOO_MANY_VALUES");
  assert.equal(addCombination(draft, first.items[0].combination).error.projected, 101);
  assert.ok(Date.now() - started < 500);
});

test("marking a value and deleting its option in the same draft builds a valid save body", () => {
  const draft = draftFromProduct(fullPolo());
  assert.equal(removeOption(draft, uuid(200)).error.code, "OPTION_HAS_SEVERAL_VALUES");
  const marked = must(removeValue(draft, uuid(202)));
  const removed = must(removeOption(marked, uuid(200)));
  const body = saveProductRequestSchema.parse(buildSaveProductBody(removed, { structureVersion: 3, name: "Polo", description: null, imageId: null }));
  assert.deepEqual(body.options.map((option) => option.name), ["Talla"]);
  assert.deepEqual(body.deletedVariantIds, [uuid(5001), uuid(5003)]);
  assert.deepEqual([body.variants, body.newVariants], [[], []]);
});

test("a value whose variants have orders or stock cannot be marked, and the last option needs an active variant", () => {
  const draft = draftFromProduct(fullPolo({ "M / Azul": { hasOrders: true }, "S / Azul": { stock: 2 } }));
  const blocked = removeValue(draft, uuid(202));
  assert.deepEqual([blocked.success, blocked.error.code, blocked.error.blocked], [false, "VARIANT_HAS_ORDERS_OR_STOCK", 2]);

  const talla = optionSpec(1, "Talla", ["S"]);
  const single = draftFromProduct(savedProduct([talla], [{ values: ["S"], status: "inactive" }]));
  assert.equal(removeOption(single, talla.id).error.code, "LAST_OPTION_VARIANT_INACTIVE");
  const active = must(removeOption(draftFromProduct(savedProduct([talla], [{ values: ["S"], price: 33 }])), talla.id));
  const body = saveProductRequestSchema.parse(buildSaveProductBody(active, { structureVersion: 3, name: "Polo", description: null, imageId: null }));
  assert.deepEqual([body.options, body.variants, body.deletedVariantIds], [[], [], []]);
});

test("a draft from a product treats every status other than active as inactive", () => {
  const draft = draftFromProduct(fullPolo({ "S / Negro": { status: "archived" } }));
  assert.equal(rowOf(draft, "S / Negro").status, "inactive");
  assert.equal(variantCounter(draft).inactive, 1);
});

test("builds the create body from the draft without the removed rows", () => {
  let draft = newPolo();
  draft = dropRow(draft, rowOf(draft, "S / Azul").ref);
  draft = setRow(draft, rowOf(draft, "L / Azul").ref, { salePrice: 42.9, sku: " L-A " });
  const body = createProductRequestSchema.parse(buildCreateProductBody(draft, { id: "11111111-1111-4111-8111-111111111111", name: "Polo", description: null, imageId: null, currency: "PEN" }));
  assert.equal(body.variants.length, 5);
  assert.deepEqual(body.variants[4], { values: [uuid(103), uuid(202)], sku: "L-A", salePrice: 42.9, purchasePrice: 20, initialStock: 4 });
  assert.deepEqual(body.options.map((option) => option.valueForExistingVariants), [undefined, undefined]);

  const plain = createProductRequestSchema.parse(buildCreateProductBody(createDraft({ ...base, sku: "POLO" }), { id: "11111111-1111-4111-8111-111111111111", name: "Polo", description: null, imageId: null, currency: "PEN" }));
  assert.deepEqual([plain.options, plain.variants], [[], [{ values: [], sku: "POLO", salePrice: 39.9, purchasePrice: 20, initialStock: 4 }]]);
});

const withManga = (customize = {}) => must(addOption(draftFromProduct(fullPolo(customize)), optionSpec(3, "Manga", ["Corta", "Larga"])));

test("changing the value for existing variants keeps saved variants and swaps which combinations are new", () => {
  const draft = withManga({ "S / Azul": { status: "inactive" } });
  const savedRefs = orderedRows(draft).filter((row) => row.id !== null).map((row) => [row.ref, row.id]);
  const edited = setRow(draft, rowOf(draft, "S / Negro / Corta").ref, { sku: "S-N" });
  const swapped = must(setValueForExistingVariants(edited, uuid(300), uuid(302)));
  assert.deepEqual(orderedRows(swapped).filter((row) => row.id !== null).map((row) => [row.ref, row.id]), savedRefs);
  assert.deepEqual(orderedRows(swapped).filter((row) => row.id !== null).map((row) => rowLabel(swapped, row)), ["S / Negro / Larga", "S / Azul / Larga", "M / Negro / Larga", "M / Azul / Larga"]);
  assert.equal(rowOf(swapped, "S / Negro / Larga").sku, "S-N");
  assert.equal(rowOf(swapped, "S / Azul / Corta").copiedFromInactive, true);
  assert.equal(swapped.options.length, 3);
  const body = saveProductRequestSchema.parse(buildSaveProductBody(swapped, { structureVersion: 3, name: "Polo", description: null, imageId: null }));
  assert.deepEqual([body.options[2].valueForExistingVariants, body.deletedVariantIds, body.newVariants.length], [uuid(302), [], 4]);
  assert.equal(setValueForExistingVariants(draft, uuid(100), uuid(101)).error.code, "OPTION_NOT_NEW");
  assert.equal(setValueForExistingVariants(draft, uuid(999), uuid(101)).error.code, "OPTION_NOT_FOUND");
  assert.equal(setValueForExistingVariants(draft, uuid(300), uuid(999)).error.code, "VALUE_NOT_FOUND");
});

test("a row removed before the value for existing variants changes is not removed afterwards in its place", () => {
  const draft = withManga();
  const marked = must(removeRow(draft, rowOf(draft, "S / Negro / Larga").ref));
  const swapped = must(setValueForExistingVariants(marked, uuid(300), uuid(302)));
  assert.deepEqual(swapped.rows.filter((row) => row.marked), []);
  const body = saveProductRequestSchema.parse(buildSaveProductBody(swapped, { structureVersion: 3, name: "Polo", description: null, imageId: null }));
  assert.deepEqual([body.deletedVariantIds, body.newVariants.length], [[], 4]);
});

test("the editor tells a missing option, value and row apart", () => {
  const draft = withManga();
  assert.equal(removeOption(draft, uuid(999)).error.code, "OPTION_NOT_FOUND");
  assert.equal(addValue(draft, uuid(999), { id: uuid(998), name: "X" }).error.code, "OPTION_NOT_FOUND");
  assert.equal(removeValue(draft, uuid(999)).error.code, "VALUE_NOT_FOUND");
  assert.equal(removeRow(draft, "missing").error.code, "ROW_NOT_FOUND");
});

test("an option cannot repeat an id inside its own input", () => {
  const draft = createDraft(base);
  const repeatedValue = { id: uuid(100), name: "Talla", values: [{ id: uuid(101), name: "S" }, { id: uuid(101), name: "M" }] };
  assert.equal(addOption(draft, repeatedValue).error.code, "DUPLICATE_ID");
  const optionAsValue = { id: uuid(100), name: "Talla", values: [{ id: uuid(100), name: "S" }] };
  assert.equal(addOption(draft, optionAsValue).error.code, "DUPLICATE_ID");
});

test("an option or value id already in the draft cannot be added again", () => {
  const draft = must(removeOption(withManga(), uuid(300)));
  assert.equal(addOption(draft, optionSpec(3, "Manga", ["Corta", "Larga"])).error.code, "DUPLICATE_ID");
  assert.equal(addValue(draft, uuid(100), { id: uuid(101), name: "Otra" }).error.code, "DUPLICATE_ID");
});

test("the value given to existing variants cannot be removed, so saved variants are never deleted through it", () => {
  const draft = withManga({ "M / Azul": { stock: 3 } });
  assert.equal(removeValue(draft, uuid(301)).error.code, "VALUE_FOR_EXISTING_VARIANTS");
  const swapped = must(setValueForExistingVariants(draft, uuid(300), uuid(302)));
  const marked = must(removeValue(swapped, uuid(301)));
  const body = saveProductRequestSchema.parse(buildSaveProductBody(marked, { structureVersion: 3, name: "Polo", description: null, imageId: null }));
  assert.deepEqual([body.deletedVariantIds, body.newVariants.length, body.options[2].values.map((value) => value.name)], [[], 0, ["Larga"]]);
});

test("an option left without live values is not sent, and neither are its values in the new variants", () => {
  let draft = createDraft(base);
  draft = must(addOption(draft, optionSpec(1, "Talla", ["S", "M"])));
  draft = must(addOption(draft, optionSpec(2, "Color", ["Negro"])));
  draft = must(removeValue(draft, uuid(201)));
  const meta = { id: "11111111-1111-4111-8111-111111111111", name: "Polo", description: null, imageId: null, currency: "PEN" };
  const body = buildCreateProductBody(draft, meta);
  assert.deepEqual(body.options.map((option) => option.name), ["Talla"]);
  assert.deepEqual(body.variants, []);
});

test("removing a saved row is refused and hidden selected rows ignore marked rows", () => {
  const saved = draftFromProduct(fullPolo());
  assert.equal(removeRow(saved, rowOf(saved, "S / Negro").ref).error.code, "SAVED_VARIANT");
  let draft = newPolo();
  const selected = toggleAll(draft, [], null);
  draft = dropRow(draft, rowOf(draft, "S / Negro").ref);
  assert.equal(hiddenSelectedCount(draft, selected, uuid(202)), 2);
  assert.equal(hiddenSelectedCount(draft, selected, uuid(201)), 3);
});
