import { afterEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";

const { publishEvent, indexProductPhotos } = vi.hoisted(() => {
  process.env.IMAGE_EMBEDDER_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "key";
  return { publishEvent: vi.fn(), indexProductPhotos: vi.fn() };
});
vi.mock("@core/src/composition/event-bus", () => ({ applicationEventBus: () => ({ publishEvent }) }));
vi.mock("@core/src/shared/infrastructure/persistance", () => ({
  getCompanyId: () => "00000000-0000-4000-8000-000000000001", withTenantIsolation: (_company: string, work: () => unknown) => work() }));
vi.mock("@core/src/features/products/application/index-product-photos", async (original) => ({
  ...await original<typeof import("@core/src/features/products/application/index-product-photos")>(), indexProductPhotos }));

import { createMessageCandidateLimits, createVisualSearch, indexProductPhotosHandler, publishProductPhotosAdded } from "@core/src/features/products/composition";

afterEach(() => { vi.restoreAllMocks(); });

describe("createVisualSearch", () => {
  test("builds the adapter of the configured provider and disables visual search without its key", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const setup = createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", IMAGE_EMBEDDER_PROVIDER: "openai", OPENAI_API_KEY: "key", PRODUCT_MATCH_MIN_CONFIDENCE: "" });
    const model = "openai/gpt-6-luna+text-embedding-3-small";
    expect(setup.embedder).toMatchObject({ model, embedImage: expect.any(Function) });
    expect(setup.visual).toMatchObject({ model, candidates: 5, minConfidence: 0.8, chooseProduct: expect.any(Function) });
    expect(info).not.toHaveBeenCalled();

    expect(createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", OPENAI_API_KEY: "" })).toMatchObject({ embedder: null, visual: null, photoStagesReserveUsd: 0 });
    expect(info).toHaveBeenLastCalledWith({ event: "product_visual_search_disabled", reason: "missing_api_key" }, "product_visual_search_disabled");
  });

  test("selects the local embedder by default and the configured provider and model otherwise", () => {
    const local = createVisualSearch({ OPENAI_API_KEY: "key" });
    expect(local.embedder?.model).toBe("local/onnx-community/siglip2-base-patch16-224-ONNX");
    expect(local.visual?.model).toBe(local.embedder?.model);
    expect(createVisualSearch({ OPENAI_API_KEY: "key", IMAGE_EMBEDDER_PROVIDER: "local", IMAGE_EMBEDDER_MODEL: "Xenova/clip-vit-base-patch16" }).embedder?.model)
      .toBe("local/Xenova/clip-vit-base-patch16");
    expect(createVisualSearch({ OPENAI_API_KEY: "key", IMAGE_EMBEDDER_PROVIDER: "openai", IMAGE_EMBEDDER_MODEL: "", IMAGE_DESCRIBE_MODEL: "" }).embedder?.model)
      .toBe("openai/gpt-6-luna+text-embedding-3-small");

  });

  test("keeps visual search disabled without the key even though the local embedder needs none", () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    expect(createVisualSearch({ IMAGE_EMBEDDER_PROVIDER: "local" })).toMatchObject({ embedder: null, visual: null });
  });

  test("PRODUCT_MATCH_CANDIDATES above 8 fails at startup", () => {
    expect(() => createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_CANDIDATES: "9" })).toThrow();
    expect(createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_CANDIDATES: "8" }).visual?.candidates).toBe(8);
  });

  test("PRODUCT_MATCH_TIMEOUT_MS above 20000 fails at startup, and the photo stage deadline is twice the timeout", () => {
    expect(() => createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_TIMEOUT_MS: "20001" })).toThrow();
    expect(createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_TIMEOUT_MS: "20000" }).photoStageTimeoutMs).toBe(40_000);
  });

  test("exposes the reserve of the configured stages, with the describer only for the OpenAI embedder", () => {
    const local = createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_CANDIDATES: "8" });
    const openai = createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCH_CANDIDATES: "8", IMAGE_EMBEDDER_PROVIDER: "openai" });
    expect(local.photoStagesReserveUsd).toBeCloseTo(0.00099, 5);
    expect(openai.photoStagesReserveUsd).toBeLessThanOrEqual(0.00125);
    expect(openai.photoStagesReserveUsd).toBeGreaterThan(local.photoStagesReserveUsd);
  });

  test("a matcher or describer model with no price fails at startup", () => {
    expect(() => createVisualSearch({ OPENAI_API_KEY: "key", PRODUCT_MATCHER_MODEL: "unpriced-model" })).toThrow(/unpriced-model/);
    expect(() => createVisualSearch({ OPENAI_API_KEY: "key", IMAGE_EMBEDDER_PROVIDER: "openai", IMAGE_DESCRIBE_MODEL: "unpriced-model" })).toThrow(/unpriced-model/);
    expect(createVisualSearch({ OPENAI_API_KEY: "key", IMAGE_DESCRIBE_MODEL: "unpriced-model" }).visual).not.toBeNull();
    expect(createVisualSearch({ PRODUCT_MATCHER_MODEL: "unpriced-model" }).visual).toBeNull();
  });

  test("fails at startup for an unknown provider name", () => {
    expect(() => createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "acme", OPENAI_API_KEY: "key" })).toThrow();
    expect(() => createVisualSearch({ IMAGE_EMBEDDER_PROVIDER: "acme" })).toThrow();
  });
});

describe("createMessageCandidateLimits", () => {
  test("defaults to 8 sellable and 2 not-sellable candidates", () => {
    expect(createMessageCandidateLimits({})).toMatchObject({ candidates: 8, unavailableCandidates: 2, maxWords: 30 });
  });

  test.each([
    { TEXT_MATCH_CANDIDATES: "9" }, { TEXT_MATCH_UNAVAILABLE_CANDIDATES: "5" }, { TEXT_MATCH_MAX_WORDS: "31" }, { TEXT_MATCH_PAIR_BUDGET: "50001" },
  ])("%o fails at startup", (env) => {
    expect(() => createMessageCandidateLimits(env)).toThrow();
  });

  test("accepts every bound", () => {
    expect(createMessageCandidateLimits({ TEXT_MATCH_CANDIDATES: "8", TEXT_MATCH_UNAVAILABLE_CANDIDATES: "4", TEXT_MATCH_MAX_WORDS: "30", TEXT_MATCH_PAIR_BUDGET: "50000" }))
      .toMatchObject({ candidates: 8, unavailableCandidates: 4, maxWords: 30, pairBudget: 50_000 });
  });
});

describe("product image indexing logs", () => {
  const companyId = "00000000-0000-4000-8000-000000000001";
  const productId = "00000000-0000-4000-8000-000000000002";

  test("product_photos_added_publish_failed carries the publication error as err", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const failure = { code: "EVENT_BUS_UNAVAILABLE", message: "Event bus is not ready" } as const;
    publishEvent.mockResolvedValueOnce(err(failure));
    expect(await publishProductPhotosAdded(productId as never)).toEqual(err(failure));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "product_photos_added_publish_failed", companyId, productId, err: failure }), "product_photos_added_publish_failed");
  });

  const metadata = { eventId: "event-a", occurredAt: "2026-10-17T12:00:00.000Z" };
  const run = (attempt: number) => indexProductPhotosHandler({ companyId, productId } as never, metadata, { signal: new AbortController().signal, attempt });
  const photo = (n: number) => `00000000-0000-4000-8000-0000000000a${n}`;
  const failure = (n: number, code: string) => ({ imageId: photo(n), code, message: code });

  test("each failed photo is logged once per attempt with its image and code", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    vi.spyOn(log, "error").mockImplementation(() => {});
    indexProductPhotos.mockResolvedValueOnce(ok({ kind: "processed", indexed: [], failed: [failure(1, "EMBEDDER_UNAVAILABLE"), failure(2, "IMAGE_STORAGE_UNAVAILABLE")] }));
    expect(await run(2)).toMatchObject({ success: false, error: { code: "EMBEDDER_UNAVAILABLE", retryable: true } });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "product_photo_index_failed", imageId: photo(1), errorCode: "EMBEDDER_UNAVAILABLE", retryable: true, attempt: 2, eventId: "event-a" }), "product_photo_index_failed");
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ imageId: photo(2), errorCode: "IMAGE_STORAGE_UNAVAILABLE" }), "product_photo_index_failed");
  });

  test("a permanent photo failure is logged at error level only on the first attempt of a job", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const debug = vi.spyOn(log, "debug").mockImplementation(() => {});
    indexProductPhotos.mockResolvedValue(ok({ kind: "processed", indexed: [], failed: [failure(2, "INVALID_EMBEDDING")] }));
    expect(await run(1)).toEqual(ok(undefined));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "product_photo_index_failed", imageId: photo(2), errorCode: "INVALID_EMBEDDING", retryable: false }), "product_photo_index_failed");
    error.mockClear();
    indexProductPhotos.mockResolvedValue(ok({ kind: "processed", indexed: [], failed: [failure(2, "INVALID_EMBEDDING"), failure(3, "EMBEDDER_UNAVAILABLE")] }));
    vi.spyOn(log, "warn").mockImplementation(() => {});
    expect(await run(2)).toMatchObject({ success: false });
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: "product_photo_index_failed", imageId: photo(2) }), "product_photo_index_failed");
    indexProductPhotos.mockReset();
  });

  test("product_photos_indexed reports the indexed photos, the failed count and the queue latency", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-17T12:00:05.000Z"));
    indexProductPhotos.mockResolvedValueOnce(ok({ kind: "processed", indexed: [photo(1), photo(2)], failed: [] }));
    expect(await run(1)).toEqual(ok(undefined));
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: "product_photos_indexed", companyId, productId, imageIds: [photo(1), photo(2)],
      indexedCount: 2, failedCount: 0, queueLatencyMs: 5000, durationMs: expect.any(Number) }), "product_photos_indexed");
  });

  test("a failed state read is retried and logged as an error", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    indexProductPhotos.mockResolvedValueOnce(err({ code: "PERSISTENCE_UNAVAILABLE", message: "db" }));
    expect(await run(1)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE", retryable: true } });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "product_photos_index_failed", errorCode: "PERSISTENCE_UNAVAILABLE" }), "product_photos_index_failed");
  });
});
