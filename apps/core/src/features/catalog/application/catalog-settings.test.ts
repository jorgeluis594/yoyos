import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import {
  checkSubdomainAvailability, getCatalogSettings, saveCatalogSubdomain, setCatalogPublication,
  type CatalogSettingsAccess, type CatalogSettingsDependencies, type CompanyId, type StoredCatalogSettings, type SubdomainOwner, type UserId,
} from "@core/src/features/catalog/application/catalog-settings";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const otherCompanyId = "00000000-0000-4000-8000-000000000002" as CompanyId;
const access: CatalogSettingsAccess = { companyId, userId: "00000000-0000-4000-8000-0000000000a1" as UserId };
const subdomain = (value: string) => value as CatalogSubdomain;
const unavailable = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
const ownedByOther: SubdomainOwner = { companyId: otherCompanyId, published: true, store: { name: "Otra", currency: "PEN" } };

function deps(stored: Partial<StoredCatalogSettings> = {}, overrides: Partial<CatalogSettingsDependencies> = {}) {
  const settings: StoredCatalogSettings = { published: false, subdomain: null, companyName: "Café Fantasío", ...stored };
  const calls = {
    resolveSubdomain: vi.fn<CatalogSettingsDependencies["resolveSubdomain"]>(async () => ok(null)),
    saveSubdomain: vi.fn<CatalogSettingsDependencies["saveSubdomain"]>(async () => ok(null)),
    savePublication: vi.fn<CatalogSettingsDependencies["savePublication"]>(async (...[, published]) => ok(settings.subdomain || !published ? "saved" : "subdomain_missing")),
  };
  const dependencies: CatalogSettingsDependencies = { readCatalogSettings: async () => ok(settings), ...calls, ...overrides };
  return { dependencies, calls };
}

test("returns the available suggestion when the company has no subdomain", async () => {
  const { dependencies, calls } = deps();
  expect(await getCatalogSettings(access, dependencies)).toEqual(ok({ published: false, subdomain: null, suggestion: "cafe-fantasio" }));
  expect(calls.resolveSubdomain).toHaveBeenCalledWith("cafe-fantasio");
});

test("returns the saved subdomain without a suggestion or a lookup", async () => {
  const { dependencies, calls } = deps({ published: true, subdomain: subdomain("fantasio") });
  expect(await getCatalogSettings(access, dependencies)).toEqual(ok({ published: true, subdomain: "fantasio", suggestion: null }));
  expect(calls.resolveSubdomain).not.toHaveBeenCalled();
});

test("returns no suggestion when it is taken, reserved, too short or its lookup fails", async () => {
  const taken = deps({}, { resolveSubdomain: async () => ok(ownedByOther) });
  expect(await getCatalogSettings(access, taken.dependencies)).toEqual(ok({ published: false, subdomain: null, suggestion: null }));
  const reserved = deps({ companyName: "Pay" });
  expect(await getCatalogSettings(access, reserved.dependencies)).toEqual(ok({ published: false, subdomain: null, suggestion: null }));
  expect(reserved.calls.resolveSubdomain).not.toHaveBeenCalled();
  const short = deps({ companyName: "Ñ" });
  expect(await getCatalogSettings(access, short.dependencies)).toEqual(ok({ published: false, subdomain: null, suggestion: null }));
  expect(short.calls.resolveSubdomain).not.toHaveBeenCalled();
  const failing = deps({}, { resolveSubdomain: async () => unavailable });
  expect(await getCatalogSettings(access, failing.dependencies)).toEqual(ok({ published: false, subdomain: null, suggestion: null }));
});

test("fails the read when the settings cannot be read", async () => {
  const { dependencies } = deps({}, { readCatalogSettings: async () => unavailable });
  expect(await getCatalogSettings(access, dependencies)).toEqual(unavailable);
});

test("answers invalid without any lookup", async () => {
  const { dependencies, calls } = deps();
  expect(await checkSubdomainAvailability({ value: "fan--tasio" }, access, dependencies)).toEqual(ok({ status: "invalid", reason: "double_hyphen" }));
  expect(await checkSubdomainAvailability({ value: "fa" }, access, dependencies)).toEqual(ok({ status: "invalid", reason: "too_short" }));
  expect(calls.resolveSubdomain).not.toHaveBeenCalled();
});

test("lowercases the checked value, answers available for a free name and reserved for a reserved one", async () => {
  const { dependencies } = deps();
  expect(await checkSubdomainAvailability({ value: "Fantasio" }, access, dependencies)).toEqual(ok({ status: "available", subdomain: "fantasio" }));
  expect(await checkSubdomainAvailability({ value: "pay" }, access, dependencies)).toEqual(ok({ status: "reserved" }));
});

test("answers current for the saved subdomain even after it became reserved", async () => {
  const mine: SubdomainOwner = { companyId, published: false, store: { name: "Mía", currency: "PEN" } };
  const { dependencies } = deps({ subdomain: subdomain("pay") }, { resolveSubdomain: async () => ok(mine) });
  expect(await checkSubdomainAvailability({ value: "pay" }, access, dependencies)).toEqual(ok({ status: "current", subdomain: "pay" }));
});

test("answers in_use without revealing which company holds the name", async () => {
  const { dependencies } = deps({}, { resolveSubdomain: async () => ok(ownedByOther) });
  const answer = await checkSubdomainAvailability({ value: "fantasio" }, access, dependencies);
  expect(answer).toEqual(ok({ status: "in_use", subdomain: "fantasio" }));
  expect(JSON.stringify(answer)).not.toContain(otherCompanyId);
});

test("fails the check when the lookup fails", async () => {
  const { dependencies } = deps({}, { resolveSubdomain: async () => unavailable });
  expect(await checkSubdomainAvailability({ value: "fantasio" }, access, dependencies)).toEqual(unavailable);
});

test("saving the current subdomain succeeds without writing, also when it became reserved", async () => {
  for (const current of ["fantasio", "pay"]) {
    const { dependencies, calls } = deps({ published: true, subdomain: subdomain(current) });
    expect(await saveCatalogSubdomain({ subdomain: current }, access, dependencies))
      .toEqual(ok({ settings: { published: true, subdomain: current, suggestion: null }, change: "unchanged" }));
    expect(calls.saveSubdomain).not.toHaveBeenCalled();
  }
});

test("rejects saving a reserved, invalid or too short subdomain and writes nothing", async () => {
  const { dependencies, calls } = deps();
  expect(await saveCatalogSubdomain({ subdomain: "pay" }, access, dependencies)).toMatchObject({ success: false, error: { code: "SUBDOMAIN_RESERVED" } });
  expect(await saveCatalogSubdomain({ subdomain: "café" }, access, dependencies)).toMatchObject({ success: false, error: { code: "INVALID_SUBDOMAIN", reason: "invalid_character" } });
  expect(await saveCatalogSubdomain({ subdomain: "Fantasio" }, access, dependencies)).toMatchObject({ success: false, error: { code: "INVALID_SUBDOMAIN", reason: "invalid_character" } });
  expect(await saveCatalogSubdomain({ subdomain: "fa" }, access, dependencies)).toMatchObject({ success: false, error: { code: "INVALID_SUBDOMAIN", reason: "too_short" } });
  expect(calls.saveSubdomain).not.toHaveBeenCalled();
});

test("reports SUBDOMAIN_TAKEN and keeps the previous subdomain when the save loses the race", async () => {
  const taken = err({ code: "SUBDOMAIN_TAKEN" as const, message: "taken" });
  const { dependencies, calls } = deps({ subdomain: subdomain("anterior") }, { saveSubdomain: vi.fn(async () => taken) });
  expect(await saveCatalogSubdomain({ subdomain: "fantasio" }, access, dependencies)).toEqual(taken);
  expect(calls.savePublication).not.toHaveBeenCalled();
});

test("reports first for the first subdomain and replaced for a change", async () => {
  const first = deps({ published: false });
  expect(await saveCatalogSubdomain({ subdomain: "fantasio" }, access, first.dependencies))
    .toEqual(ok({ settings: { published: false, subdomain: "fantasio", suggestion: null }, change: "first" }));
  expect(first.calls.saveSubdomain).toHaveBeenCalledWith(companyId, "fantasio");
  const replaced = deps({ published: true, subdomain: subdomain("anterior") });
  expect(await saveCatalogSubdomain({ subdomain: "fantasio" }, access, replaced.dependencies))
    .toEqual(ok({ settings: { published: true, subdomain: "fantasio", suggestion: null }, change: "replaced" }));
});

test("fails the save when the write cannot be completed", async () => {
  const { dependencies } = deps({}, { saveSubdomain: async () => unavailable });
  expect(await saveCatalogSubdomain({ subdomain: "fantasio" }, access, dependencies)).toEqual(unavailable);
});

test("rejects publishing without a saved subdomain with SUBDOMAIN_REQUIRED", async () => {
  const { dependencies } = deps({ subdomain: null });
  expect(await setCatalogPublication({ published: true }, access, dependencies)).toMatchObject({ success: false, error: { code: "SUBDOMAIN_REQUIRED" } });
});

test("publishes with a saved subdomain and answers the settings", async () => {
  const { dependencies, calls } = deps({ published: true, subdomain: subdomain("fantasio") });
  expect(await setCatalogPublication({ published: true }, access, dependencies)).toEqual(ok({ published: true, subdomain: "fantasio", suggestion: null }));
  expect(calls.savePublication).toHaveBeenCalledWith(companyId, true);
});

test("hides the catalog with or without a subdomain", async () => {
  for (const stored of [{ subdomain: subdomain("fantasio") }, { subdomain: null }]) {
    const { dependencies, calls } = deps(stored);
    expect(await setCatalogPublication({ published: false }, access, dependencies)).toEqual(ok({ published: false, subdomain: stored.subdomain, suggestion: null }));
    expect(calls.savePublication).toHaveBeenCalledWith(companyId, false);
  }
});
