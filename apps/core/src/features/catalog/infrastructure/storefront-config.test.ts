import { expect, test } from "vitest";
import { parseStorefrontConfig, storeDomainFor, storeUrlFor } from "@core/src/features/catalog/infrastructure/storefront-config";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";

const fantasio = "fantasio" as CatalogSubdomain;
const parsed = (env: Parameters<typeof parseStorefrontConfig>[0]) => {
  const result = parseStorefrontConfig(env);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
};

test("builds https://fantasio.yoyos.lat/ and the .yoyos.lat suffix from https://yoyos.lat", () => {
  const config = parsed({ CATALOG_BASE_URL: "https://yoyos.lat", BETTER_AUTH_URL: "https://app.yoyos.lat", NODE_ENV: "production" });
  expect(storeUrlFor(config, fantasio).toString()).toBe("https://fantasio.yoyos.lat/");
  expect(storeUrlFor(config, fantasio, "/productos/abc").toString()).toBe("https://fantasio.yoyos.lat/productos/abc");
  expect(storeDomainFor(config)).toBe("yoyos.lat");
  expect(config.host).toEqual({ baseHostname: "yoyos.lat", appHostname: "app.yoyos.lat" });
});

test("keeps the port in dev: http://fantasio.localhost:3000/", () => {
  const config = parsed({ CATALOG_BASE_URL: "http://localhost:3000", BETTER_AUTH_URL: "http://localhost:3000" });
  expect(storeUrlFor(config, fantasio).toString()).toBe("http://fantasio.localhost:3000/");
  expect(storeDomainFor(config)).toBe("localhost:3000");
  expect(config.host).toEqual({ baseHostname: "localhost", appHostname: "localhost" });
});

test("falls back to http://localhost:3000 outside production", () => {
  expect(storeDomainFor(parsed({}))).toBe("localhost:3000");
  expect(storeDomainFor(parsed({ NODE_ENV: "test" }))).toBe("localhost:3000");
});

test("rejects a base URL with a path, an IP host, or http in production", () => {
  const rejected = (CATALOG_BASE_URL: string, NODE_ENV = "production") => parseStorefrontConfig({ CATALOG_BASE_URL, NODE_ENV });
  for (const value of ["https://yoyos.lat/tienda", "https://yoyos.lat/?a=1", "https://yoyos.lat/#top", "https://127.0.0.1", "https://[::1]:3000", "http://yoyos.lat", "ftp://yoyos.lat"]) {
    const result = rejected(value);
    expect(result.success, value).toBe(false);
    if (!result.success) expect(result.error).toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining("CATALOG_BASE_URL") });
  }
  expect(rejected("http://127.0.0.1:3000", "development").success).toBe(false);
  expect(rejected("http://localhost:3000", "development").success).toBe(true);
});

test("rejects the Coolify placeholder text and a missing value in production", () => {
  for (const env of [{ CATALOG_BASE_URL: "CATALOG_BASE_URL is required", NODE_ENV: "production" }, { NODE_ENV: "production" }, { CATALOG_BASE_URL: "", NODE_ENV: "production" }]) {
    const result = parseStorefrontConfig(env);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining("CATALOG_BASE_URL") });
  }
});
