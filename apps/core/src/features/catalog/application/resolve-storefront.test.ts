import { expect, test, vi } from "vitest";
import { err, ok } from "@shared/functional";
import type { CatalogSubdomain } from "@shared/catalog-subdomain";
import type { CompanyId } from "@shared/identity";
import { resolveBrandHostOwner, resolveLegacyCatalogLink, resolveStorefront } from "@core/src/features/catalog/application/resolve-storefront";
import type { SubdomainOwner } from "@core/src/features/catalog/application/catalog-settings";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const fantasio = "fantasio" as CatalogSubdomain;
const store = { name: "Fantasio", currency: "PEN" as const };
const owner = (published: boolean): SubdomainOwner => ({ companyId, published, store });
const unavailable = { success: true, data: { kind: "unavailable" } };

test("resolves the published store whose subdomain matches the host with one lookup", async () => {
  const resolveSubdomain = vi.fn(async () => ok(owner(true)));
  expect(await resolveStorefront({ host: { kind: "store", subdomain: fantasio } }, { resolveSubdomain }))
    .toEqual({ success: true, data: { kind: "published", companyId, subdomain: fantasio, store } });
  expect(resolveSubdomain).toHaveBeenCalledTimes(1);
  expect(resolveSubdomain).toHaveBeenCalledWith(fantasio);
});

test("keeps serving a published store whose subdomain was later added to the reserved list", async () => {
  const pay = "pay" as CatalogSubdomain;
  expect(await resolveStorefront({ host: { kind: "store", subdomain: pay } }, { resolveSubdomain: async () => ok(owner(true)) }))
    .toMatchObject({ success: true, data: { kind: "published", subdomain: pay } });
});

test("returns the same unavailable for an unknown, released, unowned reserved, malformed or hidden host", async () => {
  const lookups = vi.fn(async (subdomain: CatalogSubdomain) => ok(subdomain === "oculto" ? owner(false) : null));
  const resolve = (host: Parameters<typeof resolveStorefront>[0]["host"]) => resolveStorefront({ host }, { resolveSubdomain: lookups });
  const results = [
    await resolve({ kind: "store", subdomain: "no-existe" as CatalogSubdomain }),
    await resolve({ kind: "store", subdomain: "liberado" as CatalogSubdomain }),
    await resolve({ kind: "store", subdomain: "tienda" as CatalogSubdomain }),
    await resolve({ kind: "store", subdomain: "oculto" as CatalogSubdomain }),
    await resolve({ kind: "invalid" }),
  ];
  for (const result of results) expect(result).toEqual(unavailable);
  expect(lookups).toHaveBeenCalledTimes(4);
});

test("propagates a failed lookup without turning it into unavailable", async () => {
  const failure = { code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" };
  expect(await resolveStorefront({ host: { kind: "store", subdomain: fantasio } }, { resolveSubdomain: async () => err(failure) })).toEqual(err(failure));
});

test("redirects a legacy link only when the company has a subdomain and a published catalog", async () => {
  const read = (stored: { published: boolean; subdomain: CatalogSubdomain | null } | null) =>
    resolveLegacyCatalogLink({ companyId }, { readCatalogSettings: async () => ok(stored && { ...stored, companyName: "Fantasio" }) });
  expect(await read({ published: true, subdomain: fantasio })).toEqual(ok({ kind: "redirect", subdomain: fantasio }));
  expect(await read({ published: false, subdomain: fantasio })).toEqual(ok({ kind: "unavailable" }));
  expect(await read({ published: false, subdomain: null })).toEqual(ok({ kind: "unavailable" }));
  expect(await read(null)).toEqual(ok({ kind: "unavailable" }));
});

test("resolves the brand host's owner with one lookup whether the catalog is published or hidden", async () => {
  const resolveSubdomain = vi.fn(async (subdomain: CatalogSubdomain) => ok(subdomain === "oculto" ? owner(false) : owner(true)));
  expect(await resolveBrandHostOwner({ host: { kind: "store", subdomain: fantasio } }, { resolveSubdomain }))
    .toEqual({ success: true, data: { companyId, subdomain: fantasio, published: true } });
  expect(await resolveBrandHostOwner({ host: { kind: "store", subdomain: "oculto" as CatalogSubdomain } }, { resolveSubdomain }))
    .toEqual({ success: true, data: { companyId, subdomain: "oculto", published: false } });
  expect(resolveSubdomain).toHaveBeenCalledTimes(2);
});

test("resolves no owner for an unheld subdomain or a host that is not a store, and passes a failed lookup on", async () => {
  expect(await resolveBrandHostOwner({ host: { kind: "store", subdomain: fantasio } }, { resolveSubdomain: async () => ok(null) })).toEqual({ success: true, data: null });
  const resolveSubdomain = vi.fn();
  for (const host of [{ kind: "app" }, { kind: "invalid" }] as const) expect(await resolveBrandHostOwner({ host }, { resolveSubdomain })).toEqual({ success: true, data: null });
  expect(resolveSubdomain).not.toHaveBeenCalled();
  const failure = err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "down" });
  expect(await resolveBrandHostOwner({ host: { kind: "store", subdomain: fantasio } }, { resolveSubdomain: async () => failure })).toEqual(failure);
});
