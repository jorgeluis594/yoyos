import { afterEach, expect, test, vi } from "vitest";
import type { CompanyId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { storeAppearance } from "@core/src/features/store-appearance/composition";
import { catalogBrowse } from "@core/src/features/catalog/browse-composition";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
const clasico = { logoUrl: null, theme: "classic" };
afterEach(() => vi.restoreAllMocks());

test("catalog appearance is Clásico without logo when the read fails and the failure is logged", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const getPublic = vi.spyOn(storeAppearance, "getPublic").mockRejectedValue(new Error("down"));
  expect(await catalogBrowse.storeAppearance(companyId)).toEqual({ kind: "fallback", appearance: clasico });
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ event: "unable_to_read_catalog", operation: "read_appearance", errorCode: "PERSISTENCE_UNAVAILABLE" }), "unable_to_read_catalog");

  getPublic.mockResolvedValue({ kind: "custom", appearance: { logoUrl: "not a url", theme: "noche" } } as never);
  expect(await catalogBrowse.storeAppearance(companyId)).toEqual({ kind: "fallback", appearance: clasico });
  expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "read_appearance", errorCode: "INVALID_STORED_DATA" }), "unable_to_read_catalog");

  for (const kind of ["default", "fallback"] as const) {
    getPublic.mockResolvedValue({ kind } as never);
    expect(await catalogBrowse.storeAppearance(companyId)).toEqual({ kind, appearance: clasico });
  }
});

test("catalog appearance keeps the theme and logo of a custom appearance", async () => {
  const appearance = { logoUrl: "https://cdn.example/logo.png", theme: "suave" };
  vi.spyOn(storeAppearance, "getPublic").mockResolvedValue({ kind: "custom", appearance } as never);
  expect(await catalogBrowse.storeAppearance(companyId)).toEqual({ kind: "custom", appearance });
});
