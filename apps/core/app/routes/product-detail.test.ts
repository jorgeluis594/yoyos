import { log } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, ClientActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, clientAction, loader } from "@core/app/routes/product-detail";
import { productEditing } from "@core/src/features/products/product-editing";

const id = "00000000-0000-4000-8000-000000000099";
const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as ActionFunctionArgs["context"];
const valid = { structureVersion: 3, name: "Nuevo", description: null, imageId: null, options: [], variants: [], newVariants: [], deletedVariantIds: [] };
const put = (body: unknown, path = "/es-PE/products/1") => new Request(`http://localhost${path}`, { method: "PUT", body: JSON.stringify(body) });
const run = (request: Request) => action({ request, context, params: { productId: id } } as unknown as ActionFunctionArgs);

afterEach(() => vi.restoreAllMocks());

test("rejects manipulated non-editable fields before invoking the save", async () => {
  const save = vi.spyOn(productEditing, "save");
  expect(await run(put({ ...valid, currency: "PEN" }))).toMatchObject({ errors: { form: "La solicitud contiene campos no permitidos." } });
  expect(save).not.toHaveBeenCalled();
});

test("surfaces expected save failures on the form and reports an uncertain result with the reload notice", async () => {
  vi.spyOn(productEditing, "save").mockResolvedValue({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Missing" } });
  expect(await run(put(valid))).toEqual({ errors: { form: "El producto ya no está disponible." }, issues: [] });
  vi.spyOn(productEditing, "save").mockRejectedValue(new Error("secret database detail"));
  vi.spyOn(log, "error").mockImplementation(() => {});
  expect(await run(put(valid))).toEqual({ errors: { inDoubt: "Puede que se hayan guardado los cambios. Recarga el producto para revisarlos." }, issues: [] });
});

test("answers a stale structure version with the reload notice and keeps the rejection per row", async () => {
  vi.spyOn(productEditing, "save").mockResolvedValue({ success: false, error: { code: "PRODUCT_CHANGED", message: "Changed" } });
  expect(await run(put(valid))).toEqual({ errors: { changed: "Este producto cambió desde que lo abriste. Recarga el producto para ver los cambios." }, issues: [] });
  vi.spyOn(productEditing, "save").mockResolvedValue({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid", issues: [
    { scope: "newVariant", index: 0, field: "sku", reason: "DUPLICATE_SKU", message: "dup" },
  ] } });
  expect(await run(put(valid))).toMatchObject({ errors: { sku: "Este SKU ya está en uso." }, issues: [{ scope: "newVariant", index: 0, message: "SKU en uso por otra variante" }] });
});

test("maps absence and technical failures while loading the edit form", async () => {
  vi.spyOn(productEditing, "get").mockResolvedValue({ success: true, data: null });
  await expect(loader({ context, params: { productId: id }, request: new Request(`http://localhost/es-PE/products/${id}`) } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  vi.spyOn(productEditing, "get").mockRejectedValue(new Error("secret storage detail"));
  vi.spyOn(log, "error").mockImplementation(() => {});
  await expect(loader({ context, params: { productId: id }, request: new Request(`http://localhost/es-PE/products/${id}`) } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});

// A 5xx status keeps React Router from revalidating the loaders, which also fail offline and would replace the form with the load error.
const clientRun = (serverAction: () => Promise<unknown>) => clientAction({ request: put(valid, `/es-PE/products/${id}`), serverAction } as unknown as ClientActionFunctionArgs);

test("a save that gets no response keeps the form with the connection notice and a status that skips revalidation", async () => {
  expect(await clientRun(async () => { throw new TypeError("Failed to fetch"); })).toMatchObject({
    data: { errors: { form: "No se pudo guardar. Revisa tu conexión e inténtalo otra vez." }, issues: [] }, init: { status: 503 },
  });
});

test("a gateway failure on the save keeps the form with the uncertain-result notice", async () => {
  const inDoubt = { data: { errors: { inDoubt: "Puede que se hayan guardado los cambios. Recarga el producto para revisarlos." }, issues: [] }, init: { status: 503 } };
  expect(await clientRun(async () => { throw new Response("Bad gateway", { status: 504 }); })).toMatchObject(inDoubt);
  expect(await clientRun(async () => { throw { status: 502, statusText: "Bad Gateway", data: "html", internal: true }; })).toMatchObject(inDoubt);
});

test("a rejection from the server passes through and a client error still reaches the error boundary", async () => {
  const answer = { errors: { form: "x" }, issues: [] };
  expect(await clientRun(async () => answer)).toBe(answer);
  const refused = new Response("nope", { status: 403 });
  await expect(clientRun(async () => { throw refused; })).rejects.toBe(refused);
});
