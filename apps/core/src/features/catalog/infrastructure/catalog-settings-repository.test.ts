import { afterEach, expect, test, vi } from "vitest";
import type { CompanyId } from "@shared/identity";
import { log } from "@core/src/shared/infrastructure/logger";
import { prisma } from "@core/src/shared/infrastructure/persistance";
import { readStorefrontState } from "@core/src/features/catalog/infrastructure/catalog-settings-repository";

const companyId = "00000000-0000-4000-8000-000000000001" as CompanyId;
afterEach(() => vi.restoreAllMocks());

test("a stored storefront row that is not valid is reported as invalid stored data and logged", async () => {
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  const query = vi.spyOn(prisma, "$queryRaw");
  for (const row of [
    { catalogPublished: true, catalogSubdomain: "Not Valid", country: "PE" },
    { catalogPublished: false, catalogSubdomain: null, country: "XX" },
  ]) {
    query.mockResolvedValueOnce([row] as never);
    expect(await readStorefrontState(companyId)).toMatchObject({ success: false, error: { code: "INVALID_STORED_DATA" } });
    expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ event: "unable_to_read_catalog", operation: "read_storefront", errorCode: "INVALID_STORED_DATA" }), "unable_to_read_catalog");
  }
});
