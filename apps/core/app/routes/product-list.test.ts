import { log } from "@core/src/shared/infrastructure/logger";
import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/product-list";
import { productEditing } from "@core/src/features/products/product-editing";

const context = { get: () => ({ company: { id: "00000000-0000-4000-8000-000000000001", country: "PE" } }) } as unknown as LoaderFunctionArgs["context"];
const args = (url: string) => ({ request: new Request(url), context }) as LoaderFunctionArgs;

afterEach(() => vi.restoreAllMocks());

test("passes URL criteria to the catalog operation", async () => {
  const list = vi.spyOn(productEditing, "list").mockResolvedValue({ success: true, data: { items: [], page: 2, pageSize: 20, total: 0 } });
  expect(await loader(args("http://localhost/es-PE/products?search=blue&page=2"))).toMatchObject({ search: "blue", list: { page: 2 } });
  expect(list).toHaveBeenCalledWith({ search: "blue", page: 2 });
  await loader(args("http://localhost/es-PE/products?page=0x10"));
  expect(list).toHaveBeenLastCalledWith({ page: NaN });
  expect(await loader(args("http://localhost/pt-BR/products"))).toMatchObject({ base: "/pt-BR/products" });
});

test("keeps invalid criteria and technical failures distinct", async () => {
  vi.spyOn(productEditing, "list").mockResolvedValueOnce({ success: false, error: { code: "VALIDATION_ERROR", issues: [{ field: "page", reason: "INVALID_RANGE", message: "Invalid page" }], message: "Invalid criteria" } })
    .mockRejectedValueOnce(new Error("secret storage detail"));
  vi.spyOn(log, "error").mockImplementation(() => {});
  await expect(loader(args("http://localhost/es-PE/products?page=0"))).rejects.toMatchObject({ status: 400 });
  await expect(loader(args("http://localhost/es-PE/products"))).rejects.toMatchObject({ status: 503 });
});
