import { Prisma } from "@prisma/client";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import { parseCatalogSubdomain, type CatalogSubdomain } from "@shared/catalog-subdomain";
import { countryCurrencies, isCountry, type Country } from "@shared/country";
import type { CompanyId } from "@shared/identity";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { inActiveTransaction, prisma, systemPrisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure, transactionFailureStage } from "@core/src/shared/infrastructure/persistence-error";
import type { SaveSubdomainError, StoredCatalogSettings, StorefrontState, SubdomainOwner } from "@core/src/features/catalog/application/catalog-settings";

export type PersistenceError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;
type ReadError = PersistenceError | Readonly<{ code: "INVALID_STORED_DATA"; message: string }>;

const unavailable = (message: string) => err({ code: "PERSISTENCE_UNAVAILABLE" as const, message });
const invalidStored = (message: string) => err({ code: "INVALID_STORED_DATA" as const, message });
const subdomainRow = z.object({ company_id: z.uuid(), published: z.boolean(), name: z.string(), country: z.string().refine(isCountry) });

/** Null when the company is not visible under RLS, so callers decide what an unknown company means. */
export async function readCatalogSettings(companyId: CompanyId): Promise<Result<StoredCatalogSettings | null, ReadError>> {
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { catalogPublished: true, catalogSubdomain: true, name: true } });
    if (!company) return ok(null);
    if (company.catalogSubdomain === null) return ok({ published: company.catalogPublished, subdomain: null, companyName: company.name });
    const subdomain = parseCatalogSubdomain(company.catalogSubdomain);
    if (subdomain.success) return ok({ published: company.catalogPublished, subdomain: subdomain.data, companyName: company.name });
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_settings", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
    return invalidStored("Stored catalog subdomain is invalid");
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_settings", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return unavailable("Unable to read catalog settings");
  }
}

const storefrontRow = z.object({ catalogPublished: z.boolean(), catalogSubdomain: z.string().nullable(), country: z.custom<Country>(isCountry) });

/** One statement through the context client: inside a transaction it joins it, and a transaction failure is the transaction's to report. */
export async function readStorefrontState(companyId: CompanyId): Promise<Result<StorefrontState, ReadError>> {
  try {
    const rows = await prisma.$queryRaw<unknown[]>`SELECT "catalogPublished", "catalogSubdomain", country FROM "Company" WHERE id = ${companyId}::uuid`;
    if (rows.length === 0) {
      log.error({ event: "unable_to_read_catalog", companyId, operation: "read_storefront", errorCode: "PERSISTENCE_UNAVAILABLE" }, "unable_to_read_catalog");
      return unavailable("Company not found");
    }
    const row = storefrontRow.safeParse(rows[0]);
    const subdomain = row.success && row.data.catalogSubdomain !== null ? parseCatalogSubdomain(row.data.catalogSubdomain) : undefined;
    if (row.success && (subdomain === undefined || subdomain.success)) {
      const currency = countryCurrencies[row.data.country];
      if (subdomain === undefined) return ok({ currency, catalog: { kind: "hidden_without_link" } });
      return ok({ currency, catalog: { kind: row.data.catalogPublished ? "published" : "hidden", subdomain: subdomain.data } });
    }
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_storefront", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
    return invalidStored("Stored storefront data is invalid");
  } catch (cause) {
    if (inActiveTransaction() && transactionFailureStage(cause)) throw cause;
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_catalog", companyId, operation: "read_storefront", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return unavailable("Unable to read the storefront");
  }
}

/** One cross-company round trip through the SECURITY DEFINER function; the `Company` RLS policy still protects every other read and write. */
export async function resolveSubdomain(subdomain: CatalogSubdomain): Promise<Result<SubdomainOwner | null, ReadError>> {
  try {
    const rows = await systemPrisma.$queryRaw<unknown[]>`SELECT company_id, published, name, country FROM public.resolve_catalog_subdomain(${subdomain})`;
    if (rows.length === 0) return ok(null);
    const row = subdomainRow.safeParse(rows[0]);
    if (row.success && isCountry(row.data.country)) {
      return ok({ companyId: row.data.company_id as CompanyId, published: row.data.published, store: { name: row.data.name, currency: countryCurrencies[row.data.country] } });
    }
    log.error({ event: "unable_to_read_catalog", operation: "resolve_subdomain", errorCode: "INVALID_STORED_DATA" }, "unable_to_read_catalog");
    return invalidStored("Stored catalog data is invalid");
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_catalog", operation: "resolve_subdomain", errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_catalog");
    return unavailable("Unable to resolve catalog subdomain");
  }
}

/** The unique index decides a race: one UPDATE assigns the new value and releases the old one in the same commit. */
export async function saveSubdomain(companyId: CompanyId, subdomain: CatalogSubdomain): Promise<Result<null, SaveSubdomainError>> {
  try {
    const { count } = await prisma.company.updateMany({ where: { id: companyId }, data: { catalogSubdomain: subdomain } });
    if (count === 1) return ok(null);
    log.error({ event: "unable_to_save_catalog_subdomain", companyId, errorCode: "PERSISTENCE_UNAVAILABLE" }, "unable_to_save_catalog_subdomain");
    return unavailable("Unable to save catalog subdomain");
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return err({ code: "SUBDOMAIN_TAKEN", message: "Subdomain is already in use" });
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_catalog_subdomain", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_catalog_subdomain");
    return unavailable("Unable to save catalog subdomain");
  }
}

const requiresSubdomainCheck = "Company_catalogPublished_requires_subdomain_check";
const violatesPublicationRule = (cause: unknown): boolean =>
  cause instanceof Error && (cause.message.includes(requiresSubdomainCheck) || violatesPublicationRule(cause.cause));

/** Publishing is one conditional UPDATE that also requires the subdomain; hiding is unconditional. The CHECK is the backstop. */
export async function savePublication(companyId: CompanyId, published: boolean): Promise<Result<"saved" | "subdomain_missing", PersistenceError>> {
  try {
    const { count } = await prisma.company.updateMany({ where: { id: companyId, ...(published ? { catalogSubdomain: { not: null } } : {}) }, data: { catalogPublished: published } });
    if (count === 1) return ok("saved");
    if (published) return ok("subdomain_missing");
    log.error({ event: "unable_to_save_catalog_settings", companyId, errorCode: "PERSISTENCE_UNAVAILABLE" }, "unable_to_save_catalog_settings");
    return unavailable("Unable to save catalog settings");
  } catch (cause) {
    if (violatesPublicationRule(cause)) return ok("subdomain_missing");
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_save_catalog_settings", companyId, errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_save_catalog_settings");
    return unavailable("Unable to save catalog settings");
  }
}
