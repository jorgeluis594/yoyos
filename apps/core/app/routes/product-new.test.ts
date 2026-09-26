import { afterEach, expect, test, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { action } from "@core/app/routes/product-new";
import { products } from "@core/src/features/products/composition";

const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as ActionFunctionArgs["context"];
const valid = { name: "Cuaderno", currency: "PEN", variants: [{ attributes: {}, salePrice: 12.5 }] };

afterEach(() => vi.restoreAllMocks());

test("rejects client company identity before invoking creation", async () => {
  const create = vi.spyOn(products, "create");
  const request = new Request("http://localhost/es-PE/products/new", { method: "POST", body: JSON.stringify({ ...valid, companyId: "forged" }) });
  expect(await action({ request, context } as ActionFunctionArgs)).toMatchObject({ errors: { form: "La solicitud contiene campos no permitidos." } });
  expect(create).not.toHaveBeenCalled();
});

test("reports technical save failures safely and preserves the form route", async () => {
  vi.spyOn(products, "create").mockRejectedValue(new Error("secret database detail"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const request = new Request("http://localhost/es-PE/products/new", { method: "POST", body: JSON.stringify(valid) });
  expect(await action({ request, context } as ActionFunctionArgs)).toEqual({ errors: { form: "No se pudo guardar el producto. Inténtalo de nuevo." } });
  expect(products.create).toHaveBeenCalledOnce();
});
