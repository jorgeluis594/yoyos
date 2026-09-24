import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { action, loader } from "@core/app/routes/product-detail";
import { products } from "@core/src/features/products/composition";

const id = "00000000-0000-4000-8000-000000000099";
const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as ActionFunctionArgs["context"];

afterEach(() => vi.restoreAllMocks());

test("rejects manipulated non-editable fields before invoking the update", async () => {
  const update = vi.spyOn(products, "update");
  const request = new Request("http://localhost/es-PE/products/1", { method: "POST", body: JSON.stringify({ currency: "PEN" }) });
  expect(await action({ request, context, params: { productId: id } } as unknown as ActionFunctionArgs)).toMatchObject({ errors: { form: "La solicitud contiene campos no permitidos." } });
  expect(update).not.toHaveBeenCalled();
});

test("surfaces expected update failures on the form and reports technical failures safely", async () => {
  vi.spyOn(products, "update").mockResolvedValue({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Missing" } });
  const notFound = new Request("http://localhost/es-PE/products/1", { method: "POST", body: JSON.stringify({ name: "Nuevo" }) });
  expect(await action({ request: notFound, context, params: { productId: id } } as unknown as ActionFunctionArgs)).toEqual({ errors: { form: "El producto ya no está disponible." } });
  vi.spyOn(products, "update").mockRejectedValue(new Error("secret database detail"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const request = new Request("http://localhost/es-PE/products/1", { method: "POST", body: JSON.stringify({ name: "Nuevo" }) });
  expect(await action({ request, context, params: { productId: id } } as unknown as ActionFunctionArgs)).toEqual({ errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } });
});

test("maps absence and technical failures while loading the edit form", async () => {
  vi.spyOn(products, "get").mockResolvedValue({ success: true, data: null });
  await expect(loader({ context, params: { productId: id }, request: new Request(`http://localhost/es-PE/products/${id}`) } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
  vi.spyOn(products, "get").mockRejectedValue(new Error("secret storage detail"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(loader({ context, params: { productId: id }, request: new Request(`http://localhost/es-PE/products/${id}`) } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});
