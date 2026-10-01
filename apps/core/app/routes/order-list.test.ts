import { afterEach, expect, test, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/order-list";
import { orders } from "@core/src/features/orders/composition";

const context = { get: () => ({ company: { country: "PE", id: "company" }, user: { id: "seller" } }) } as unknown as LoaderFunctionArgs["context"];
const args = (url: string) => ({ request: new Request(url), context }) as LoaderFunctionArgs;

afterEach(() => vi.restoreAllMocks());

test("filters sales by Lima calendar days, including the start and excluding the next midnight", async () => {
  const list = vi.spyOn(orders, "listAggregates").mockResolvedValue({ success: true, data: { items: [], page: 1, pageSize: 20, total: 0 } });
  vi.spyOn(orders, "searchContacts").mockResolvedValue({ success: true, data: [] });

  const result = await loader(args("http://localhost/es-PE/orders?createdFrom=2026-09-28&createdBefore=2026-09-29"));

  expect(list).toHaveBeenCalledWith({ page: 1, customer: { kind: "all" },
    createdFrom: new Date("2026-09-28T05:00:00.000Z"), createdBefore: new Date("2026-09-29T05:00:00.000Z") },
  { companyId: "company", userId: "seller" });
  expect(result.filters).toMatchObject({ createdFrom: "2026-09-28T05:00:00.000Z", createdBefore: "2026-09-29T05:00:00.000Z" });

  await loader(args("http://localhost/es-PE/orders?createdFrom=1990-01-01"));
  expect(list).toHaveBeenLastCalledWith({ page: 1, customer: { kind: "all" }, createdFrom: new Date("1990-01-01T04:00:00.000Z") },
    { companyId: "company", userId: "seller" });
  await expect(loader(args("http://localhost/es-PE/orders?createdFrom=2026-02-31"))).rejects.toMatchObject({ status: 400 });
});
