import assert from "node:assert/strict";
import { test } from "node:test";
import { apiErrorResponseSchema } from "./registration.ts";
import { catalogSettingsErrorSchema, catalogSettingsSchema, subdomainAvailabilitySchema, subdomainErrorReason } from "./catalog.ts";

const settings = { published: false, subdomain: null, url: null, domain: "localhost:3000", suggestion: "cafe-fantasio" };

test("settings accept a missing subdomain and a saved one with its brand url", () => {
  assert.ok(catalogSettingsSchema.safeParse(settings).success);
  assert.ok(catalogSettingsSchema.safeParse({ ...settings, published: true, subdomain: "fantasio", url: "https://fantasio.yoyos.lat/", domain: "yoyos.lat", suggestion: null }).success);
  assert.equal(catalogSettingsSchema.safeParse({ ...settings, extra: 1 }).success, false);
  assert.equal(catalogSettingsSchema.safeParse({ published: false, url: null }).success, false);
});

test("availability answers are the five distinct outcomes", () => {
  for (const answer of [{ status: "available", subdomain: "a" }, { status: "current", subdomain: "a" }, { status: "in_use", subdomain: "a" }, { status: "reserved" }, { status: "invalid", reason: "too_short" }])
    assert.ok(subdomainAvailabilitySchema.safeParse(answer).success, answer.status);
  assert.equal(subdomainAvailabilitySchema.safeParse({ status: "invalid", reason: "other" }).success, false);
});

test("every catalog error body the routes send parses with the api envelope and the catalog schema", () => {
  const bodies = [
    { code: "INVALID_SUBDOMAIN", error: "Invalid subdomain", issues: [{ field: "subdomain", reason: "hyphen_edge" }] },
    { code: "SUBDOMAIN_RESERVED", error: "Reserved" }, { code: "SUBDOMAIN_TAKEN", error: "Taken" }, { code: "SUBDOMAIN_REQUIRED", error: "Required" },
    { code: "RATE_LIMITED", error: "Slow down" }, { code: "INVALID_CATALOG_SETTINGS", error: "Invalid" }, { code: "SERVICE_UNAVAILABLE", error: "Down" },
  ];
  for (const body of bodies) {
    assert.ok(apiErrorResponseSchema.safeParse(body).success, body.code);
    assert.ok(catalogSettingsErrorSchema.safeParse(body).success, body.code);
  }
  assert.equal(catalogSettingsErrorSchema.safeParse({ code: "INVALID_SUBDOMAIN", error: "x" }).success, false);
  assert.equal(catalogSettingsErrorSchema.safeParse({ code: "NOPE", error: "x" }).success, false);
});

test("subdomainErrorReason returns the format reason of INVALID_SUBDOMAIN only", () => {
  const invalid = catalogSettingsErrorSchema.parse({ code: "INVALID_SUBDOMAIN", error: "x", issues: [{ field: "subdomain", reason: "double_hyphen" }] });
  assert.equal(subdomainErrorReason(invalid), "double_hyphen");
  assert.equal(subdomainErrorReason(catalogSettingsErrorSchema.parse({ code: "SUBDOMAIN_TAKEN", error: "x" })), null);
});
