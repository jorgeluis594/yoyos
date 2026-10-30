import { expect, test, vi } from "vitest";
import { checkOrderExists } from "@core/src/features/orders/presentation/order-existence";

const fetcher = (answer: () => Promise<Response>) => vi.fn(answer) as unknown as typeof fetch;

test("reads the order uncached with a timeout and tells found from missing", async () => {
  const found = fetcher(async () => new Response("{}", { status: 200 }));
  expect(await checkOrderExists("o1", found)).toBe("exists");
  expect(found).toHaveBeenCalledWith("/api/orders/o1/aggregate", expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }));
  expect(await checkOrderExists("o1", fetcher(async () => new Response("", { status: 404 })))).toBe("missing");
});

test("is unknown when the check fails, answers a server error or never answers", async () => {
  expect(await checkOrderExists("o1", fetcher(async () => new Response("", { status: 503 })))).toBe("unknown");
  expect(await checkOrderExists("o1", fetcher(async () => { throw new TypeError("offline"); }))).toBe("unknown");
});
