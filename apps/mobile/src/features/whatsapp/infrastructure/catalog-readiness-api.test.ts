import { err, ok } from "@shared/functional";
import { createCatalogReadinessApi } from "./catalog-readiness-api";

test("reads the catalog readiness state and rejects an invalid answer", async () => {
  const request = jest.fn(async () => ok({ version: 1, state: "no_searchable_photos" }));
  expect(await createCatalogReadinessApi(request)()).toEqual(ok("no_searchable_photos"));
  expect(request).toHaveBeenCalledWith("/api/products/search-readiness");

  expect(await createCatalogReadinessApi(async () => ok({ version: 1, state: "unknown" }))()).toMatchObject({ success: false, error: { code: "INVALID_RESPONSE" } });
  const failure = err({ code: "NETWORK_ERROR" as const, message: "offline" });
  expect(await createCatalogReadinessApi(async () => failure)()).toEqual(failure);
});
