import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseAgencyCatalog, parseCourierCatalog, parseCsv } from "./catalog-files";

const header = "id,courier,external_id,name,address,district_code,enabled";
const row = (overrides: Partial<Record<"id" | "courier" | "external" | "name" | "address" | "district" | "enabled", string>> = {}) =>
  [overrides.id ?? "6f1c2f0e-4a53-4d0b-9a57-0d3f5b1e8c11", overrides.courier ?? "shalom", overrides.external ?? "2", overrides.name ?? "MIRAFLORES",
    overrides.address ?? '"AV. LARCO 1301, REF. ""FRENTE"" AL PARQUE"', overrides.district ?? "150122", overrides.enabled ?? "true"].join(",");
const shalom = new Set(["shalom"]);

describe("parseCsv", () => {
  test("reads quoted commas, doubled quotes, CRLF and a trailing line break", () => {
    expect(parseCsv('﻿a,"b, c","d ""e"""\r\n1,,3\n')).toEqual({ success: true, data: [["a", "b, c", 'd "e"'], ["1", "", "3"]] });
  });

  test("rejects an unclosed quote", () => {
    expect(parseCsv('a,"b\n').success).toBe(false);
  });
});

describe("parseAgencyCatalog", () => {
  test("parses rows into catalog agencies", () => {
    expect(parseAgencyCatalog(`${header}\n${row()}\n${row({ id: "7a2d3f1e-5b64-4e1c-8b68-1e4f6c2a9d22", external: "3", enabled: "false" })}\n`, shalom)).toEqual({ success: true, data: [
      { id: "6f1c2f0e-4a53-4d0b-9a57-0d3f5b1e8c11", courier: "shalom", externalId: "2", name: "MIRAFLORES", address: 'AV. LARCO 1301, REF. "FRENTE" AL PARQUE', districtCode: "150122", enabled: true },
      { id: "7a2d3f1e-5b64-4e1c-8b68-1e4f6c2a9d22", courier: "shalom", externalId: "3", name: "MIRAFLORES", address: 'AV. LARCO 1301, REF. "FRENTE" AL PARQUE', districtCode: "150122", enabled: false },
    ] });
  });

  test("reports every invalid row with its line instead of loading part of the file", () => {
    const result = parseAgencyCatalog([header, row(), row({ external: "3" }), row({ id: "7a2d3f1e-5b64-4e1c-8b68-1e4f6c2a9d22" }),
      row({ id: "8b3e4a2f-6c75-4f2d-9c79-2f5a7d3b0e33", external: "4", district: "999999" }), row({ id: "9c4f5b3a-7d86-4a3e-8d8a-3a6b8e4c1f44", external: "5", courier: "olva" }), "a,b"].join("\n"), shalom);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message.split("\n").slice(1).map((line) => line.split(":")[0])).toEqual(["line 3", "line 4", "line 5", "line 6", "line 7"]);
    expect(result.error.message).toContain("duplicate id");
    expect(result.error.message).toContain("duplicate external_id 2 for shalom");
    expect(result.error.message).toContain("Unknown district");
    expect(result.error.message).toContain("unknown courier olva");
  });

  test("requires the exact header", () => {
    expect(parseAgencyCatalog(`id,courier,name\n${row()}`, shalom)).toMatchObject({ success: false, error: { code: "INVALID_CATALOG_FILE" } });
  });

  test("the committed catalog files are valid", () => {
    const couriers = parseCourierCatalog(readFileSync(new URL("../../../../prisma/catalog/couriers.json", import.meta.url), "utf8"));
    expect(couriers.success).toBe(true);
    if (!couriers.success) return;
    const agencies = parseAgencyCatalog(readFileSync(new URL("../../../../prisma/catalog/agencies.csv", import.meta.url), "utf8"), new Set(couriers.data.map((courier) => courier.code)));
    expect(agencies.success ? null : agencies.error.message).toBeNull();
  });
});

describe("parseCourierCatalog", () => {
  test("rejects malformed JSON, duplicate codes and invalid codes", () => {
    expect(parseCourierCatalog("{").success).toBe(false);
    expect(parseCourierCatalog(JSON.stringify([{ code: "a", name: "A", enabled: true }, { code: "a", name: "B", enabled: true }])).success).toBe(false);
    expect(parseCourierCatalog(JSON.stringify([{ code: "Bad Code", name: "A", enabled: true }])).success).toBe(false);
  });
});
