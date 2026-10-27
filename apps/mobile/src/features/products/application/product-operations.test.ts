import { ok } from "@shared/functional";
import { addOption, createDraft } from "@shared/product-variants";
import { createProductApi } from "@mobile/features/products/infrastructure/product-api";
import { createProductOperations } from "@mobile/features/products/application/product-operations";
import { editorDraftOf } from "@mobile/features/products/domain/product-editor";
import type { Product, ProductId } from "@mobile/features/products/domain/product";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const productId = id(900) as ProductId;
const base = { sku: "BASE-1", salePrice: 39.9, purchasePrice: 20, stock: 4 };
const must = <T,>(edit: { success: true; data: T } | { success: false; error: { code: string } }) => { if (!edit.success) throw new Error(edit.error.code); return edit.data; };

test("creating a product without options sends its single variant from the base values", async () => {
  const request = jest.fn().mockResolvedValue(ok({ id: productId }));
  const operations = createProductOperations(createProductApi(request, () => 0));
  await operations.createProduct({ id: productId, country: "PE", name: "Camisa", photo: { kind: "keep" }, draft: createDraft(base) });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    id: productId, name: "Camisa", description: null, imageId: null, currency: "PEN", options: [],
    variants: [{ values: [], sku: "BASE-1", salePrice: 39.9, purchasePrice: 20, initialStock: 4 }],
  });
});

test("creating with options sends them in order with one variant per live combination", async () => {
  const request = jest.fn().mockResolvedValue(ok({ id: productId }));
  const operations = createProductOperations(createProductApi(request, () => 0));
  const draft = must(addOption(createDraft(base), { id: id(1), name: "Talla", values: [{ id: id(10), name: "S" }, { id: id(11), name: "M" }] }));
  await operations.createProduct({ id: productId, country: "PE", name: "Polo", description: "Algodón", photo: { kind: "set", imageId: id(77) as never }, draft });
  const body = JSON.parse(request.mock.calls[0][1].body);
  expect(body).toMatchObject({ description: "Algodón", imageId: id(77), options: [{ id: id(1), name: "Talla", values: [{ id: id(10), name: "S" }, { id: id(11), name: "M" }] }] });
  expect(body.variants).toEqual([
    { values: [id(10)], sku: null, salePrice: 39.9, purchasePrice: 20, initialStock: 4 },
    { values: [id(11)], sku: null, salePrice: 39.9, purchasePrice: 20, initialStock: 4 },
  ]);
});

const saved: Product = {
  id: productId, name: "Camisa", currency: "PEN", structureVersion: 7, photo: { id: id(77) as never, url: "https://cdn.example/a.jpg" }, options: [],
  variants: [{ id: id(100) as never, qrCode: id(200) as never, combination: [], salePrice: { amount: 20, currency: "PEN" }, stock: 1, status: "active", hasOrders: false }],
};

test("saving sends the version the form was loaded with and keeps the photo unless it changes", async () => {
  const request = jest.fn().mockResolvedValue(ok({ product: { ...saved, description: null, imageId: id(77), qrCode: id(300), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    variants: [{ id: id(100), combination: [], sku: null, salePrice: { amount: 20, currency: "PEN" }, purchasePrice: null, qrCode: id(200), status: "active", stock: 1, hasOrders: false }] },
    image: { id: id(77), url: "https://cdn.example/a.jpg" } }));
  const operations = createProductOperations(createProductApi(request, () => 0));
  const result = await operations.saveProduct({ current: saved, name: "Camisa nueva", description: null, photo: { kind: "keep" }, draft: editorDraftOf(saved) });
  expect(request.mock.calls[0][1].method).toBe("PUT");
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    structureVersion: 7, name: "Camisa nueva", description: null, imageId: id(77), options: [], variants: [], newVariants: [], deletedVariantIds: [],
  });
  expect(result.success).toBe(true);
  await operations.saveProduct({ current: saved, name: "Camisa", description: null, photo: { kind: "remove" }, draft: editorDraftOf(saved) });
  expect(JSON.parse(request.mock.calls[1][1].body).imageId).toBeNull();
});

test("the editor draft of a saved product starts without changes", () => {
  const draft = editorDraftOf(saved);
  expect(draft).toMatchObject({ saved: true, options: [], rows: [{ id: id(100), status: "active", hasOrders: false, marked: false }] });
});
