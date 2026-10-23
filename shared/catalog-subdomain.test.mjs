import assert from "node:assert/strict";
import { test } from "node:test";
import { isReservedCatalogSubdomain, parseCatalogSubdomain, reservedCatalogSubdomains, suggestCatalogSubdomain } from "./catalog-subdomain.ts";

const reasonOf = (value) => {
  const parsed = parseCatalogSubdomain(value);
  assert.equal(parsed.success, false, `${value} should be invalid`);
  return parsed.error.reason;
};

test("accepts fantasio, fantasio-store and 3 to 30 lowercase letters, digits and single hyphens", () => {
  for (const value of ["fantasio", "fantasio-store", "abc", "a1b", "a".repeat(30), "tienda-2-ropa"]) {
    const parsed = parseCatalogSubdomain(value);
    assert.deepEqual(parsed, { success: true, data: value });
  }
});

test("reports contains_domain for fantasio.yoyos.lat and https://fantasio", () => {
  assert.equal(reasonOf("fantasio.yoyos.lat"), "contains_domain");
  assert.equal(reasonOf("https://fantasio"), "contains_domain");
  assert.equal(reasonOf(".yoyos.lat"), "contains_domain");
});

test("reports contains_space for a value pasted with a trailing space", () => {
  assert.equal(reasonOf("fantasio "), "contains_space");
  assert.equal(reasonOf("mi tienda"), "contains_space");
});

test("reports invalid_character for café and Café- before any other reason", () => {
  assert.equal(reasonOf("café"), "invalid_character");
  assert.equal(reasonOf("Café-"), "invalid_character");
  assert.equal(reasonOf("Fantasio"), "invalid_character");
  assert.equal(reasonOf("pañales"), "invalid_character");
});

test("reports too_long for a 40 character value", () => {
  assert.equal(reasonOf("a".repeat(40)), "too_long");
  assert.equal(parseCatalogSubdomain("a".repeat(31)).success, false);
});

test("reports hyphen_edge for fantasio- and for a leading hyphen of one or two characters", () => {
  assert.equal(reasonOf("fantasio-"), "hyphen_edge");
  assert.equal(reasonOf("-fantasio"), "hyphen_edge");
  assert.equal(reasonOf("-"), "hyphen_edge");
  assert.equal(reasonOf("-f"), "hyphen_edge");
});

test("reports double_hyphen for fan--tasio", () => {
  assert.equal(reasonOf("fan--tasio"), "double_hyphen");
});

test("reports too_short for fa", () => {
  assert.equal(reasonOf("fa"), "too_short");
  assert.equal(reasonOf(""), "too_short");
});

test("treats every name of the product reserved list as reserved", () => {
  const product = ["www", "api", "app", "admin", "mail", "smtp", "ftp", "cdn", "static", "assets", "status", "docs", "help", "support", "billing", "pay",
    "checkout", "catalogo", "catalog", "yoyos", "landing", "auth", "login", "signup", "webhook", "webhooks", "dev", "staging", "test"];
  for (const name of product) {
    assert.ok(reservedCatalogSubdomains.has(name), name);
    assert.ok(isReservedCatalogSubdomain(name), name);
  }
  assert.equal(isReservedCatalogSubdomain("fantasio"), false);
});

test("suggests cafe-fantasio for «Café Fantasío», cut to 30 characters without edge hyphens", () => {
  assert.equal(suggestCatalogSubdomain("Café Fantasío"), "cafe-fantasio");
  assert.equal(suggestCatalogSubdomain("  Moda   Niño & Co.  "), "moda-nino-co");
  const long = suggestCatalogSubdomain("Boutique de Ropa Femenina Lucía Fernández");
  assert.equal(long, "boutique-de-ropa-femenina-luci");
  assert.equal(suggestCatalogSubdomain(`${"a".repeat(29)} bcd`), "a".repeat(29));
});

test("suggests nothing when the converted company name is shorter than 3 characters", () => {
  assert.equal(suggestCatalogSubdomain("Ñ"), null);
  assert.equal(suggestCatalogSubdomain("!!"), null);
  assert.equal(suggestCatalogSubdomain("ab"), null);
});
