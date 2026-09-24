import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/product-detail";
import { products } from "@core/src/features/products/composition";

const id = "00000000-0000-4000-8000-000000000099";
const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as LoaderFunctionArgs["context"];

afterEach(() => vi.restoreAllMocks());

test("maps absence to 404 without disclosing other companies", async () => {
  vi.spyOn(products, "get").mockResolvedValue({ success: true, data: null });
  await expect(loader({ context, params: { productId: id } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 404 });
});

test("maps technical lookup failures to a safe retryable response", async () => {
  vi.spyOn(products, "get").mockRejectedValue(new Error("secret storage detail"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(loader({ context, params: { productId: id } } as unknown as LoaderFunctionArgs)).rejects.toMatchObject({ status: 503 });
});
