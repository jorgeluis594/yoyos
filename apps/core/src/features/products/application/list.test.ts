import { expect, test, vi } from "vitest";
import { listProducts, type ListOutput } from "@core/src/features/products/application/list";

const output: ListOutput = { items: [], page: 1, pageSize: 20, total: 0 };

test("normalizes search and pagination without changing the input", async () => {
  const list = vi.fn(async () => output);
  const input = Object.freeze({ search: "  blue  shirt  " });
  expect(await listProducts(input, { list })).toEqual({ success: true, data: output });
  expect(list).toHaveBeenCalledWith({ search: "blue  shirt", page: 1, pageSize: 20 });
  await listProducts({ search: "  " }, { list });
  expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
});

test("rejects invalid explicit criteria before querying", async () => {
  const list = vi.fn(async () => output);
  for (const input of [
    { page: 0, pageSize: 101 }, { page: 1.5 }, { pageSize: NaN },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, { search: 12 as unknown as string },
  ]) {
    expect(await listProducts(input, { list })).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  }
  expect(list).not.toHaveBeenCalled();
});
