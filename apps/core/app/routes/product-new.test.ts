import { log } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs, ClientActionFunctionArgs } from "react-router";
import { action, clientAction } from "@core/app/routes/product-new";
import { productEditing } from "@core/src/composition/product-editing";
import type { ProductId } from "@core/src/features/products/domain/product";

const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as ActionFunctionArgs["context"];
const valid = {
  id: "00000000-0000-4000-8000-000000000001", name: "Cuaderno", description: null, imageId: null, currency: "PEN", options: [],
  variants: [{ values: [], sku: null, salePrice: 12.5, purchasePrice: null, initialStock: 0 }],
};

afterEach(() => vi.restoreAllMocks());

test("rejects client company identity before invoking creation", async () => {
  const create = vi.spyOn(productEditing, "create");
  const request = new Request("http://localhost/es-PE/products/new", { method: "POST", body: JSON.stringify({ ...valid, companyId: "forged" }) });
  expect(await action({ request, context } as ActionFunctionArgs)).toMatchObject({ errors: { form: "La solicitud contiene campos no permitidos." } });
  expect(create).not.toHaveBeenCalled();
});

test("reports an uncertain creation without exposing technical detail", async () => {
  vi.spyOn(productEditing, "create").mockRejectedValue(new Error("secret database detail"));
  vi.spyOn(log, "error").mockImplementation(() => {});
  const request = new Request("http://localhost/es-PE/products/new", { method: "POST", body: JSON.stringify(valid) });
  expect(await action({ request, context } as ActionFunctionArgs)).toEqual({ errors: { form: "No se pudo confirmar si se creó este producto. Revisa el catálogo antes de iniciar otra creación." }, issues: [] });
  expect(productEditing.create).toHaveBeenCalledOnce();
});

test("keeps Portuguese in the product redirect", async () => {
  vi.spyOn(productEditing, "create").mockResolvedValue({ success: true, data: "00000000-0000-4000-8000-000000000002" as ProductId });
  const request = new Request("http://localhost/pt-BR/products/new", { method: "POST", body: JSON.stringify(valid) });
  const response = await action({ request, context } as ActionFunctionArgs);
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).headers.get("Location")).toBe("/pt-BR/products/00000000-0000-4000-8000-000000000002");
});

test("returns Portuguese validation errors for Portuguese routes", async () => {
  const request = new Request("http://localhost/pt-BR/products/new", { method: "POST", body: JSON.stringify({ ...valid, companyId: "forged" }) });
  expect(await action({ request, context } as ActionFunctionArgs)).toMatchObject({ errors: { form: "A solicitação contém campos não permitidos." } });
});

const clientRun = (serverAction: () => Promise<unknown>) => clientAction({
  request: new Request("http://localhost/es-PE/products/new", { method: "POST", body: JSON.stringify(valid) }), serverAction,
} as unknown as ClientActionFunctionArgs);

test("a creation that gets no response keeps the form with the connection notice and a status that skips revalidation", async () => {
  expect(await clientRun(async () => { throw new TypeError("Failed to fetch"); })).toMatchObject({
    data: { errors: { form: "No se pudo guardar. Revisa tu conexión e inténtalo otra vez." }, issues: [] }, init: { status: 503 },
  });
});

test("a gateway failure on the creation keeps the form with the uncertain-result notice", async () => {
  expect(await clientRun(async () => { throw new Response("Gateway timeout", { status: 504 }); })).toMatchObject({
    data: { errors: { form: "No se pudo confirmar si se creó este producto. Revisa el catálogo antes de iniciar otra creación." }, issues: [] }, init: { status: 503 },
  });
});

test("a client error from the server still reaches the error boundary", async () => {
  const refused = new Response("nope", { status: 403 });
  await expect(clientRun(async () => { throw refused; })).rejects.toBe(refused);
});
