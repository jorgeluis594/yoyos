import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { parseCompanyId, type StoreAppearance, type CompanyId, type ImageId } from "@core/src/features/store-appearance/domain/store-appearance";
import { loadStoreAppearance, loadCompanyName, persistStoreAppearance } from "@core/src/features/store-appearance/infrastructure/store-appearance-repository";

afterEach(() => { vi.restoreAllMocks(); });

function newCompanyId(): CompanyId {
  const parsed = parseCompanyId(randomUUID());
  if (!parsed.success) throw new Error("fixture");
  return parsed.data;
}

async function withCompanies(run: (a: { id: CompanyId; imageId: ImageId }, b: { id: CompanyId; imageId: ImageId }) => Promise<void>) {
  const companies = [newCompanyId(), newCompanyId()].map((id) => ({ id, imageId: randomUUID() as ImageId }));
  for (const { id, imageId } of companies) await withTenantIsolation(id, async () => {
    await prisma.company.create({ data: { id, name: `Appearance ${id.slice(0, 4)}`, country: "PE" } });
    await prisma.image.create({ data: { id: imageId, storageKey: `logos/${imageId}` } });
  });
  try {
    await run(companies[0], companies[1]);
  } finally {
    for (const { id } of companies) await withTenantIsolation(id, async () => {
      await prisma.companyCheckoutAppearance.deleteMany();
      await prisma.image.deleteMany();
      await prisma.company.deleteMany({ where: { id } });
    });
  }
}

const appearance = (logoImageId: ImageId | null, theme: StoreAppearance["theme"] = "boutique"): StoreAppearance =>
  ({ logoImageId, theme });

describe("loadStoreAppearance", () => {
  test("returns null when the company has no appearance", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => expect(await loadStoreAppearance(a.id)).toEqual({ success: true, data: null }));
    });
  });

  test("returns the saved theme and logo of the company", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        await persistStoreAppearance(a.id, appearance(a.imageId));
        expect(await loadStoreAppearance(a.id)).toEqual({ success: true, data: appearance(a.imageId) });
      });
    });
  });

  test("does not return the appearance of another company", async () => {
    await withCompanies(async (a, b) => {
      await withTenantIsolation(a.id, async () => { await persistStoreAppearance(a.id, appearance(null)); });
      await withTenantIsolation(b.id, async () => expect(await loadStoreAppearance(a.id)).toEqual({ success: true, data: null }));
    });
  });

  test("logs the invalid fields and returns INVALID_STORED_DATA for a corrupt row", async () => {
    await withCompanies(async (a) => {
      const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
      await withTenantIsolation(a.id, async () => {
        // The enum column cannot hold a theme outside the catalog, so the adapter's read is replaced with one.
        vi.spyOn(prisma.companyCheckoutAppearance, "findUnique").mockResolvedValueOnce(
          { logoImageId: null, theme: "retired" } as never);
        expect(await loadStoreAppearance(a.id)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
      });
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "invalid_stored_store_appearance", errorCode: "INVALID_STORED_DATA", invalidFields: ["theme"], companyId: a.id }), "invalid_stored_store_appearance");
    });
  });
});

describe("persistStoreAppearance", () => {
  test("creates the appearance on the first save", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        expect(await persistStoreAppearance(a.id, appearance(a.imageId))).toEqual({ success: true, data: null });
        expect(await prisma.companyCheckoutAppearance.count()).toBe(1);
      });
    });
  });

  test("replaces the whole appearance on later saves", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        await persistStoreAppearance(a.id, appearance(a.imageId, "boutique"));
        await persistStoreAppearance(a.id, { logoImageId: null, theme: "noche" });
        expect(await loadStoreAppearance(a.id)).toEqual({ success: true, data: { logoImageId: null, theme: "noche" } });
      });
    });
  });

  test("keeps one appearance per company", async () => {
    await withCompanies(async (a, b) => {
      for (const company of [a, b]) await withTenantIsolation(company.id, async () => {
        await persistStoreAppearance(company.id, appearance(null, "antojo"));
        await persistStoreAppearance(company.id, appearance(null, "suave"));
        expect(await prisma.companyCheckoutAppearance.count()).toBe(1);
      });
    });
  });

  test("removes the logo when saved without one", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        await persistStoreAppearance(a.id, appearance(a.imageId));
        await persistStoreAppearance(a.id, appearance(null));
        expect(await loadStoreAppearance(a.id)).toMatchObject({ success: true, data: { logoImageId: null } });
      });
    });
  });

  test("rejects a logo that belongs to another company", async () => {
    await withCompanies(async (a, b) => {
      await withTenantIsolation(a.id, async () => {
        expect(await persistStoreAppearance(a.id, appearance(b.imageId))).toMatchObject({ success: false, error: { code: "INVALID_IMAGE" } });
        expect(await prisma.companyCheckoutAppearance.count()).toBe(0);
      });
    });
  });

  test("keeps an image in use as logo from being deleted", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        await persistStoreAppearance(a.id, appearance(a.imageId));
        await expect(prisma.image.delete({ where: { id: a.imageId } })).rejects.toThrow();
      });
    });
  });

  test("rejects a theme outside the five at the database", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        await expect(prisma.$executeRaw`INSERT INTO "CompanyCheckoutAppearance" ("theme", "updatedAt") VALUES ('neon', now())`).rejects.toThrow();
        expect(await prisma.companyCheckoutAppearance.count()).toBe(0);
      });
    });
  });

  test("starts a row on Clásico when no theme is given", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => {
        await prisma.$executeRaw`INSERT INTO "CompanyCheckoutAppearance" ("updatedAt") VALUES (now())`;
        expect(await loadStoreAppearance(a.id)).toEqual({ success: true, data: { logoImageId: null, theme: "classic" } });
      });
    });
  });

  test("logs and returns PERSISTENCE_UNAVAILABLE when the database fails", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const malformed = "not-a-uuid" as CompanyId;
    await withTenantIsolation(randomUUID(), async () => {
      expect(await persistStoreAppearance(malformed, appearance(null))).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      expect(await loadStoreAppearance(malformed)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
    });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "unable_to_save_store_appearance", errorCode: "PERSISTENCE_UNAVAILABLE" }), "unable_to_save_store_appearance");
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "unable_to_load_store_appearance", errorCode: "PERSISTENCE_UNAVAILABLE" }), "unable_to_load_store_appearance");
  });
});

describe("loadCompanyName", () => {
  test("returns the name of the company in context", async () => {
    await withCompanies(async (a) => {
      await withTenantIsolation(a.id, async () => expect(await loadCompanyName(a.id)).toMatchObject({ success: true, data: expect.stringMatching(/^Appearance /) }));
    });
  });
});
