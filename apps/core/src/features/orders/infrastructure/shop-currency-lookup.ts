import { err, ok } from "@shared/functional";
import { countryCurrencies, isCountry } from "@shared/country";
import type { Currency } from "@shared/money";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";

type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

/** The currency of the company's prices, from the country it registered with; null when the company or a known country is missing. */
export async function findShopCurrency(): Promise<Result<Currency | null, PersistenceError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: getCompanyId() }, select: { country: true } });
    return ok(company && isCountry(company.country) ? countryCurrencies[company.country] : null);
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_find_shop_currency", err: cause }, "unable_to_find_shop_currency");
    return err({ code: "PERSISTENCE_UNAVAILABLE", message: "Unable to read the shop currency" });
  }
}
