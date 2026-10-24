import type { CompanyId } from "@shared/identity";

/** What `brandHostBuyerOwner` leaves in `response.locals`: the company holding the brand host, absent on the app host. */
export type BrandHostLocals = { brandHostCompanyId?: CompanyId };
