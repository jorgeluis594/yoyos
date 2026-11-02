import { log } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, ClientActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, clientAction, loader } from "@core/app/routes/product-variant";
import { productEditing } from "@core/src/features/products/product-editing";
import { productVariantActions } from "@core/src/features/products/product-variant-actions";
import type { Detail } from "@core/src/features/products/application/get";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const productId = id(50), variantId = id(60), color = id(1), azul = id(2);
const context = { get: () => ({ company: { id: id(9), country: "PE" } }) } as unknown as ActionFunctionArgs["context"];
const url = `http://localhost/es-PE/products/${productId}/variants/${variantId}`;
const loadArgs = (variant = variantId, path = url) => ({ context, params: { productId, variantId: variant }, request: new Request(path) }) as unknown as LoaderFunctionArgs;
const post = (body: unknown) => ({ context, params: { productId, variantId }, request: new Request(url, { method: "POST", body: JSON.stringify(body) }) }) as unknown as ActionFunctionArgs;

const detail = (options: readonly object[] = [{ id: color, name: "Color", values: [{ id: azul, name: "Azul" }] }], quantity = 0): Detail => ({
  product: {
    id: productId, name: "Polo", hidden: false, currency: "PEN", qrCode: id(51), createdAt: new Date(0), updatedAt: new Date(0), structureVersion: 1, options,
    variants: [{ id: variantId, combination: options.length ? { [color]: azul } : {}, salePrice: { amount: 10, currency: "PEN" }, qrCode: id(70), status: "active", stock: { quantity } }],
  },
  orderedVariantIds: new Set<string>(),
  photos: [],
}) as unknown as Detail;

afterEach(() => vi.restoreAllMocks());

test("variant detail loader answers not-found with the product link for a deleted variant and without it for another company's product", async () => {
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: detail() });
  const deleted = await loader(loadArgs(id(99))) as { data: unknown; init: { status: number } };
  expect(deleted.init.status).toBe(404);
  expect(deleted.data).toEqual({ state: "missing", productHref: `/es-PE/products/${productId}` });
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: null });
  const foreign = await loader(loadArgs()) as { data: unknown; init: { status: number } };
  expect(foreign.init.status).toBe(404);
  expect(foreign.data).toEqual({ state: "missing", productHref: null });
});

test("variant detail of a simple product redirects to the product page", async () => {
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: detail([]) });
  const response = await loader(loadArgs()) as Response;
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(`/es-PE/products/${productId}`);
});

test("variant detail loader returns the variant with its combination, siblings and stock", async () => {
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: detail() });
  const result = await loader(loadArgs()) as { state: string; variant: { id: string }; product: { name: string } };
  expect(result).toMatchObject({ state: "ready", variant: { id: variantId }, product: { name: "Polo" } });
});

test("variant detail action runs the requested use case and answers the rejection next to its field", async () => {
  const update = vi.spyOn(productVariantActions, "update").mockResolvedValue({ success: false, error: { code: "DUPLICATE_SKU", message: "dup" } });
  expect(await action(post({ intent: "update", sku: "A-1" }))).toEqual({ intent: "update", failed: true, errors: { sku: "Este SKU ya lo usa otra variante." } });
  expect(update).toHaveBeenCalledWith({ productId, variantId, sku: "A-1" });
  const status = vi.spyOn(productVariantActions, "changeStatus").mockResolvedValue({ success: true, data: detail() });
  expect(await action(post({ intent: "status", status: "inactive" }))).toEqual({ intent: "status", saved: "Variante desactivada" });
  expect(status).toHaveBeenCalledWith({ productId, variantId, status: "inactive" });
});

test("variant detail action rejects unknown fields and reports an uncertain result as in doubt", async () => {
  const update = vi.spyOn(productVariantActions, "update");
  expect(await action(post({ intent: "update", sku: "A", companyId: "forged" }))).toMatchObject({ failed: true, errors: { form: "La solicitud contiene campos no permitidos." } });
  expect(update).not.toHaveBeenCalled();
  update.mockRejectedValue(new Error("secret"));
  vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await action(post({ intent: "update", sku: "A" }))).toEqual({ intent: "update", failed: true, errors: { inDoubt: "Puede que se hayan guardado los cambios. Recarga la variante para revisarlos." } });
});

test("variant detail action explains why a variant cannot be deleted and redirects after deleting it", async () => {
  const remove = vi.spyOn(productVariantActions, "delete").mockResolvedValue({ success: false, error: { code: "VARIANT_HAS_STOCK", message: "stock" } });
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: detail(undefined, 6) });
  expect(await action(post({ intent: "delete" }))).toEqual({ intent: "delete", failed: true, errors: { form: "Tiene 6 unidades en stock, por eso no se puede eliminar. Puedes desactivarla." } });
  remove.mockResolvedValue({ success: true, data: detail() });
  const response = await action(post({ intent: "delete" })) as Response;
  expect(response.headers.get("Location")).toBe(`/es-PE/products/${productId}?variantDeleted=1`);
});

test("variant detail action reports a malformed body under the intent it names", async () => {
  expect(await action(post({ intent: "combination", values: "x" }))).toMatchObject({ intent: "combination", failed: true });
  expect(await action(post({ intent: "status", status: "paused" }))).toMatchObject({ intent: "status", failed: true });
  expect(await action(post({ intent: "nope" }))).toMatchObject({ intent: "update", failed: true });
});

const clientRun = (body: unknown, serverAction: () => Promise<unknown>) => clientAction({
  request: new Request(url, { method: "POST", body: JSON.stringify(body) }), serverAction,
} as unknown as ClientActionFunctionArgs);

test("a variant action that gets no response keeps the form with the connection notice of that action and a status that skips revalidation", async () => {
  const lost = async () => { throw new TypeError("Failed to fetch"); };
  expect(await clientRun({ intent: "status", status: "inactive" }, lost)).toMatchObject({
    data: { intent: "status", failed: true, errors: { form: "No se pudo desactivar la variante. Revisa tu conexión e inténtalo otra vez." } }, init: { status: 503 },
  });
  expect(await clientRun({ intent: "update", sku: "A" }, lost)).toMatchObject({ data: { intent: "update", failed: true }, init: { status: 503 } });
});

test("a gateway failure on a variant action keeps the form with the uncertain-result notice", async () => {
  expect(await clientRun({ intent: "update", sku: "A" }, async () => { throw new Response("Gateway timeout", { status: 504 }); })).toMatchObject({
    data: { intent: "update", failed: true, errors: { inDoubt: "Puede que se hayan guardado los cambios. Recarga la variante para revisarlos." } }, init: { status: 503 },
  });
});

test("a client error from the server still reaches the error boundary", async () => {
  const refused = new Response("nope", { status: 403 });
  await expect(clientRun({ intent: "update", sku: "A" }, async () => { throw refused; })).rejects.toBe(refused);
});
