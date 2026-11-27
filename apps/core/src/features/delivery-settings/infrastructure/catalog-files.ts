import { z } from "zod";
import { err, ok } from "@shared/functional";
import { getPeruDistrict } from "@shared/peru-geography";
import type { AppError, Result } from "@shared/result";

/** System catalog files (`prisma/catalog/`) loaded by `scripts/seed-courier-catalog.ts` and `scripts/load-catalog.ts`. */
export type CatalogCourier = Readonly<{ code: string; name: string; enabled: boolean }>;
export type CatalogAgency = Readonly<{
  id: string;
  courier: string;
  externalId: string;
  name: string;
  address: string;
  districtCode: string;
  enabled: boolean;
}>;
export type CatalogFileError = AppError & Readonly<{ code: "INVALID_CATALOG_FILE" }>;

const courierCatalogSchema = z.array(z.strictObject({
  code: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/).max(40),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
})).refine((values) => new Set(values.map((value) => value.code)).size === values.length, "Courier codes must be unique");

const agencyHeader = ["id", "courier", "external_id", "name", "address", "district_code", "enabled"] as const;
const agencyRowSchema = z.strictObject({
  id: z.uuid(),
  courier: z.string().min(1).max(40),
  external_id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  district_code: z.string().regex(/^\d{6}$/).refine((code) => getPeruDistrict(code) !== null, "Unknown district"),
  enabled: z.enum(["true", "false"]),
});

const invalid = (message: string): Result<never, CatalogFileError> => err({ code: "INVALID_CATALOG_FILE", message });

export function parseCourierCatalog(text: string): Result<readonly CatalogCourier[], CatalogFileError> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return invalid("couriers.json is not valid JSON");
  }
  const parsed = courierCatalogSchema.safeParse(json);
  return parsed.success ? ok(parsed.data) : invalid(`couriers.json: ${z.prettifyError(parsed.error)}`);
}

/** RFC 4180 CSV: comma separated, fields with commas, quotes or line breaks quoted with doubled inner quotes. */
export function parseCsv(text: string): Result<readonly (readonly string[])[], CatalogFileError> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') { field += '"'; index++; }
      else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) return invalid("CSV has an unclosed quoted field");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return ok(rows.filter((values) => !(values.length === 1 && values[0] === "")));
}

/** Validates every agency row and reports all problems with their CSV line, so one load fixes the whole file. */
export function parseAgencyCatalog(text: string, courierCodes: ReadonlySet<string>): Result<readonly CatalogAgency[], CatalogFileError> {
  const csv = parseCsv(text);
  if (!csv.success) return csv;
  const [header, ...rows] = csv.data;
  if (header?.join(",") !== agencyHeader.join(",")) return invalid(`agencies.csv header must be: ${agencyHeader.join(",")}`);
  const problems: string[] = [];
  const agencies: CatalogAgency[] = [];
  const ids = new Set<string>();
  const externalIds = new Set<string>();
  rows.forEach((values, position) => {
    const line = position + 2;
    if (values.length !== agencyHeader.length) { problems.push(`line ${line}: expected ${agencyHeader.length} fields, got ${values.length}`); return; }
    const parsed = agencyRowSchema.safeParse(Object.fromEntries(agencyHeader.map((key, column) => [key, values[column]])));
    if (!parsed.success) { problems.push(`line ${line}: ${z.prettifyError(parsed.error).replaceAll("\n", " ")}`); return; }
    const row = parsed.data;
    const externalKey = `${row.courier}:${row.external_id}`;
    if (!courierCodes.has(row.courier)) problems.push(`line ${line}: unknown courier ${row.courier}`);
    if (ids.has(row.id)) problems.push(`line ${line}: duplicate id ${row.id}`);
    if (externalIds.has(externalKey)) problems.push(`line ${line}: duplicate external_id ${row.external_id} for ${row.courier}`);
    ids.add(row.id);
    externalIds.add(externalKey);
    agencies.push({ id: row.id, courier: row.courier, externalId: row.external_id, name: row.name, address: row.address, districtCode: row.district_code, enabled: row.enabled === "true" });
  });
  return problems.length > 0 ? invalid(`agencies.csv:\n${problems.join("\n")}`) : ok(agencies);
}
