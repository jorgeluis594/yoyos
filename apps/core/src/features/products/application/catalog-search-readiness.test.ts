import { describe, expect, test } from "vitest";
import { ok } from "@shared/functional";
import { catalogSearchReadiness } from "@core/src/features/products/application/catalog-search-readiness";
import type { EmbeddingModel } from "@core/src/features/products/domain/image-identification";

const model = "siglip" as EmbeddingModel;
const readiness = (presence: "none" | "hidden_only" | "offered", indexed: boolean, visualModel: EmbeddingModel | null = model) =>
  catalogSearchReadiness({ visualModel, productPresence: async () => ok(presence), hasIndexedProducts: async () => ok(indexed) });

describe("catalogSearchReadiness", () => {
  test("reports all products hidden when every product with an active variant is hidden", async () => {
    expect(await readiness("hidden_only", true)).toEqual(ok("all_products_hidden"));
  });

  test("reports no searchable photos when only hidden products have indexed photos", async () => {
    expect(await readiness("offered", false)).toEqual(ok("no_searchable_photos"));
  });

  test("reports no active products when the company has none with an active variant", async () => {
    expect(await readiness("none", false)).toEqual(ok("no_active_products"));
  });

  test("reports ready when an offered product has indexed photos and no searchable photos without the visual model", async () => {
    expect(await readiness("offered", true)).toEqual(ok("ready"));
    expect(await readiness("offered", true, null)).toEqual(ok("no_searchable_photos"));
  });
});
