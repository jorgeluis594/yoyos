import { afterEach, describe, expect, test, vi } from "vitest";
import { err } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";

const { publishEvent, createProduct, indexProductImage } = vi.hoisted(() => {
  process.env.IMAGE_EMBEDDER_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "key";
  return { publishEvent: vi.fn(), createProduct: vi.fn(), indexProductImage: vi.fn() };
});
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ publishEvent }) }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({
  getCompanyId: () => "00000000-0000-4000-8000-000000000001", withTenantIsolation: (_company: string, work: () => unknown) => work() }));
vi.mock("@core/src/features/products/application/create", () => ({ createProduct }));
vi.mock("@core/src/features/products/application/index-product-image", async (original) => ({
  ...await original<typeof import("@core/src/features/products/application/index-product-image")>(), indexProductImage }));

import { createVisualSearch, indexProductImageHandler, products } from "@core/src/features/products/composition";

afterEach(() => { vi.restoreAllMocks(); });

describe("createVisualSearch", () => {
  test("builds the adapter of the configured provider and disables visual search without its key", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const setup = createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", IMAGE_EMBEDDER_PROVIDER: "openai", OPENAI_API_KEY: "key", PRODUCT_MATCH_MIN_CONFIDENCE: "" });
    const model = "openai/gpt-6-luna+text-embedding-3-small";
    expect(setup.embedder).toMatchObject({ model, embedImage: expect.any(Function) });
    expect(setup.visual).toMatchObject({ model, candidates: 5, minConfidence: 0.8, chooseProduct: expect.any(Function) });
    expect(info).not.toHaveBeenCalled();

    expect(createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", OPENAI_API_KEY: "" })).toEqual({ embedder: null, visual: null });
    expect(info).toHaveBeenLastCalledWith({ event: "product_visual_search_disabled", reason: "missing_api_key" }, "product_visual_search_disabled");
  });

  test("fails at startup for an unknown provider name", () => {
    expect(() => createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "acme", OPENAI_API_KEY: "key" })).toThrow();
    expect(() => createVisualSearch({ IMAGE_EMBEDDER_PROVIDER: "acme" })).toThrow();
  });
});

describe("product image indexing logs", () => {
  const companyId = "00000000-0000-4000-8000-000000000001";
  const productId = "00000000-0000-4000-8000-000000000002";

  test("product_image_changed_publish_failed carries the publication error as err", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const failure = { code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not ready" } as const;
    publishEvent.mockResolvedValueOnce(err(failure));
    createProduct.mockImplementationOnce((_input, deps) => deps.publishProductImageChanged(productId));
    expect(await products.create({} as never)).toEqual(err(failure));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "product_image_changed_publish_failed", companyId, productId, err: failure }), "product_image_changed_publish_failed");
  });

  test("product_image_index_failed carries the use case error as err", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const failure = { code: "INVALID_EMBEDDING", message: "Wrong dimension" };
    indexProductImage.mockResolvedValueOnce(err(failure));
    await indexProductImageHandler({ companyId, productId } as never, { eventId: "event-a", occurredAt: "2026-10-17T12:00:00.000Z" },
      { signal: new AbortController().signal, attempt: 1 });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "product_image_index_failed", eventId: "event-a", retryable: false, err: failure }), "product_image_index_failed");
  });
});
