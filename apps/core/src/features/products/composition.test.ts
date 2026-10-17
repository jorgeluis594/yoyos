import { afterEach, describe, expect, test, vi } from "vitest";
import { ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import { createVisualSearch, type ImageEmbedderFactory } from "@core/src/features/products/composition";
import type { EmbeddingModel, EmbeddingVector } from "@core/src/features/products/domain/image-identification";

const embedder: ImageEmbedderFactory = () => ({ model: "openai/test-embedder" as EmbeddingModel, embedImage: async () => ok([0.1] as unknown as EmbeddingVector) });

afterEach(() => { vi.restoreAllMocks(); });

describe("createVisualSearch", () => {
  test("builds the adapter of the configured provider and disables visual search without its key", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const visual = createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", IMAGE_EMBEDDER_PROVIDER: "openai", OPENAI_API_KEY: "key", PRODUCT_MATCH_MIN_CONFIDENCE: "" }, embedder);
    expect(visual).toMatchObject({ model: "openai/test-embedder", candidates: 5, minConfidence: 0.8, chooseProduct: expect.any(Function) });
    expect(info).not.toHaveBeenCalled();

    expect(createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "openai", OPENAI_API_KEY: "" }, embedder)).toBeNull();
    expect(info).toHaveBeenLastCalledWith({ event: "product_visual_search_disabled", reason: "missing_api_key" }, "product_visual_search_disabled");
    expect(createVisualSearch({ OPENAI_API_KEY: "key" })).toBeNull();
    expect(info).toHaveBeenLastCalledWith({ event: "product_visual_search_disabled", reason: "embedder_unavailable" }, "product_visual_search_disabled");
  });

  test("fails at startup for an unknown provider name", () => {
    expect(() => createVisualSearch({ PRODUCT_MATCHER_PROVIDER: "acme", OPENAI_API_KEY: "key" }, embedder)).toThrow();
    expect(() => createVisualSearch({ IMAGE_EMBEDDER_PROVIDER: "acme" }, embedder)).toThrow();
  });
});
