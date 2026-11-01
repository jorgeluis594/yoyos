import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeCombinationRequestSchema, createProductRequestSchema, normalizeOptionText, productApiErrorCodeSchema, productDetailResponseSchema,
  productIssueReasonSchema, productListResponseSchema, productOptionLimits, productPhotoLimits, saveProductRequestSchema, saveProductResponseSchema,
} from "./products.ts";
import { apiErrorCodeSchema } from "./registration.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const money = { amount: 10, currency: "PEN" };
const detail = () => ({
  product: {
    id: id(1), name: "Polo", description: null, hidden: false, photos: [], currency: "PEN", qrCode: id(2), createdAt: "2026-10-26T10:00:00.000Z", updatedAt: "2026-10-26T10:00:00.000Z",
    structureVersion: 1,
    options: [{ id: id(10), name: "Talla", values: [{ id: id(11), name: "S" }, { id: id(12), name: "M" }] }],
    variants: [
      { id: id(20), combination: [{ optionId: id(10), valueId: id(11) }], sku: null, salePrice: money, purchasePrice: null, qrCode: id(21), status: "active", stock: 3, hasOrders: false },
      { id: id(22), combination: [{ optionId: id(10), valueId: id(12) }], sku: "P-M", salePrice: money, purchasePrice: money, qrCode: id(23), status: "inactive", stock: 0, hasOrders: true },
    ],
  },
});

test("product detail schema accepts unknown fields on options, values and variants", () => {
  const body = detail();
  body.product.options[0].color = "red";
  body.product.options[0].values[0].photo = "x";
  body.product.variants[0].future = true;
  body.product.variants[1].status = "archived";
  body.product.newField = 1;
  const parsed = productDetailResponseSchema.safeParse(body);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.product.variants[1].status, "archived");
});

test("product detail schema rejects a variant whose combination misses an option", () => {
  const body = detail();
  body.product.variants[0].combination = [];
  assert.equal(productDetailResponseSchema.safeParse(body).success, false);
  const foreign = detail();
  foreign.product.variants[0].combination = [{ optionId: id(10), valueId: id(99) }];
  assert.equal(productDetailResponseSchema.safeParse(foreign).success, false);
  const repeated = detail();
  repeated.product.options[0].values[1].id = id(11);
  assert.equal(productDetailResponseSchema.safeParse(repeated).success, false);
});

test("product detail schema takes ordered photos, at most the limit and none repeated", () => {
  const photo = (n) => ({ id: id(n), url: `https://img.test/${n}.jpg` });
  const body = detail();
  body.product.photos = [photo(30), photo(31)];
  assert.deepEqual(productDetailResponseSchema.parse(body).product.photos.map((item) => item.id), [id(30), id(31)]);
  body.product.photos = [photo(30), photo(30)];
  assert.equal(productDetailResponseSchema.safeParse(body).success, false);
  body.product.photos = Array.from({ length: productPhotoLimits.maxPhotos + 1 }, (_, index) => photo(40 + index));
  assert.equal(productDetailResponseSchema.safeParse(body).success, false);
});

test("product detail schema keeps the currency and ownership checks", () => {
  const currency = detail();
  currency.product.variants[0].salePrice = { amount: 1, currency: "USD" };
  assert.equal(productDetailResponseSchema.safeParse(currency).success, false);
});

test("a product without options is one variant with an empty combination", () => {
  const body = detail();
  body.product.options = [];
  body.product.variants = [{ ...body.product.variants[0], combination: [] }];
  assert.ok(productDetailResponseSchema.safeParse(body).success);
});

test("create request is strict and takes ordered options with variants that reference value ids", () => {
  const request = {
    id: id(1), name: "Polo", description: null, photoIds: [], hidden: false, currency: "PEN",
    options: [{ id: id(10), name: "Talla", values: [{ id: id(11), name: "S" }] }],
    variants: [{ values: [id(11)], sku: null, salePrice: 10, purchasePrice: null, initialStock: 0 }],
  };
  assert.ok(createProductRequestSchema.safeParse(request).success);
  assert.equal(createProductRequestSchema.safeParse({ ...request, companyId: "x" }).success, false);
  assert.equal(createProductRequestSchema.safeParse({ ...request, variants: [] }).success, false);
  assert.equal(createProductRequestSchema.safeParse({ ...request, photoIds: undefined }).success, false);
  assert.equal(createProductRequestSchema.safeParse({ ...request, photoIds: [id(40), id(41)] }).success, true);
  assert.equal(createProductRequestSchema.safeParse({ ...request, options: [{ ...request.options[0], extra: 1 }] }).success, false);
});

test("save and combination requests are strict", () => {
  const save = { structureVersion: 2, name: "Polo", description: null, options: [], variants: [], newVariants: [], deletedVariantIds: [] };
  assert.ok(saveProductRequestSchema.safeParse(save).success);
  assert.equal(saveProductRequestSchema.safeParse({ ...save, structureVersion: -1 }).success, false);
  assert.deepEqual(saveProductRequestSchema.parse({ ...save, photoIds: [] }).photoIds, []);
  assert.equal(saveProductRequestSchema.parse(save).photoIds, undefined);
  assert.ok(changeCombinationRequestSchema.safeParse({ values: [{ optionId: id(10), valueId: id(11) }, { optionId: id(12), newValue: { id: id(13), name: "XL" } }] }).success);
});

test("list items report active variants and a nullable minimum price", () => {
  const item = { id: id(1), name: "Polo", hidden: false, variantCount: 2, activeVariantCount: 0, minSalePrice: null, hasDifferentPrices: false, totalStock: 0 };
  assert.ok(productListResponseSchema.safeParse({ items: [item], page: 1, pageSize: 20, total: 1 }).success);
});

test("limits, text normalization and typed codes", () => {
  assert.deepEqual(productOptionLimits, { options: 3, valuesPerOption: 30, variants: 100, nameLength: 30 });
  assert.equal(normalizeOptionText("  M "), "m");
  assert.ok(productApiErrorCodeSchema.safeParse("PRODUCT_CHANGED").success);
  assert.equal(productApiErrorCodeSchema.safeParse("NOPE").success, false);
  assert.ok(productIssueReasonSchema.safeParse("ID_CONFLICT").success);
  for (const reason of ["TOO_MANY_PHOTOS", "DUPLICATE_PHOTO", "PHOTO_NOT_FOUND"]) assert.ok(productIssueReasonSchema.safeParse(reason).success, reason);
  assert.deepEqual(productPhotoLimits, { maxPhotos: 8 });
  assert.equal(productIssueReasonSchema.safeParse("INVALID_ATTRIBUTES").success, false);
  for (const code of ["PRODUCT_CHANGED", "ID_CONFLICT", "DUPLICATE_COMBINATION", "VARIANT_HAS_ORDERS", "VARIANT_HAS_STOCK", "LAST_VARIANT", "PRODUCT_WITHOUT_OPTIONS"])
    assert.ok(apiErrorCodeSchema.safeParse(code).success, code);
});

test("the save response is the product detail plus whether the catalog was emptied", () => {
  assert.equal(saveProductResponseSchema.safeParse({ ...detail(), catalogEmptied: true }).data?.catalogEmptied, true);
  assert.equal(saveProductResponseSchema.safeParse(detail()).success, false);
  const mismatched = detail();
  mismatched.product.variants[0].salePrice = { amount: 10, currency: "USD" };
  assert.equal(saveProductResponseSchema.safeParse({ ...mismatched, catalogEmptied: false }).success, false);
});

test("saving may omit hidden and creating requires it", () => {
  const save = { structureVersion: 1, name: "Polo", description: null, options: [], variants: [], newVariants: [], deletedVariantIds: [] };
  assert.equal(saveProductRequestSchema.safeParse(save).success, true);
  assert.equal(saveProductRequestSchema.safeParse({ ...save, hidden: true }).success, true);
  assert.equal(saveProductRequestSchema.safeParse({ ...save, hidden: "yes" }).success, false);
  const create = { id: "11111111-1111-4111-8111-111111111111", name: "Polo", description: null, photoIds: [], currency: "PEN", options: [], variants: [{ values: [], sku: null, salePrice: 1, purchasePrice: null, initialStock: 0 }] };
  assert.equal(createProductRequestSchema.safeParse(create).success, false);
  assert.equal(createProductRequestSchema.safeParse({ ...create, hidden: false }).success, true);
});
