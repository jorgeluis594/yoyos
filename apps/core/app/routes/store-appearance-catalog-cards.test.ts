import { afterEach, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { LoaderFunctionArgs } from "react-router";
import { loader } from "@core/app/routes/store-appearance-catalog-cards";
import { privateUserContext } from "@core/app/private-user-context";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";
import { bindRequestOperation } from "@core/src/shared/infrastructure/logger";
import type { ProductId } from "@core/src/features/products/domain/product";

vi.mock("@core/src/shared/infrastructure/logger", async (importOriginal) => ({
  ...await importOriginal<typeof import("@core/src/shared/infrastructure/logger")>(), bindRequestOperation: vi.fn(),
}));

const companyId = "00000000-0000-4000-8000-000000000001";
const args = { context: { get: (key: unknown) => (key === privateUserContext ? { company: { id: companyId } } : undefined) } } as unknown as LoaderFunctionArgs;
const card = { id: "00000000-0000-4000-8000-000000000002" as ProductId, name: "Polo", imageUrl: null, price: { kind: "single" as const, amount: { amount: 10, currency: "PEN" as const } }, soldOut: false };
afterEach(() => vi.restoreAllMocks());

test("the cards route answers the seller's cards, samples for an empty list and a no-store 503 for a failed read", async () => {
  const previewCards = vi.spyOn(catalogBrowse, "previewCards").mockResolvedValue(ok([card]));
  const answer = await loader(args);
  expect(answer.headers.get("Cache-Control")).toBe("no-store");
  expect(await answer.json()).toMatchObject({ kind: "products", cards: [{ name: "Polo" }] });
  expect(previewCards).toHaveBeenCalledWith({ companyId });
  expect(bindRequestOperation).toHaveBeenCalledWith({ operation: "get_catalog_preview_cards" });
  previewCards.mockResolvedValue(ok([]));
  expect(await (await loader(args)).json()).toEqual({ kind: "samples" });
  previewCards.mockResolvedValue(err({ code: "PERSISTENCE_UNAVAILABLE", message: "down" }));
  await expect(loader(args)).rejects.toMatchObject({ status: 503, headers: expect.anything() });
  expect(bindRequestOperation).toHaveBeenLastCalledWith({ outcome: "technical_failure" });
});
