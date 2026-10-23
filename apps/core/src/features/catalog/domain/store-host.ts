import { parseCatalogSubdomain, type CatalogSubdomain } from "@shared/catalog-subdomain";

export type StoreHost =
  | Readonly<{ kind: "app" }>
  | Readonly<{ kind: "store"; subdomain: CatalogSubdomain }>
  | Readonly<{ kind: "invalid" }>;
export type HostConfig = Readonly<{ baseHostname: string; appHostname: string }>;

const app: StoreHost = { kind: "app" };
const invalid: StoreHost = { kind: "invalid" };

/** Judges format only: the reserved list and the owner lookup belong to the caller. The app host and every name outside the base are `app`. */
export function classifyHost(hostname: string, config: HostConfig): StoreHost {
  const host = hostname.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (host === config.appHostname || !host.endsWith(`.${config.baseHostname}`)) return app;
  const label = host.slice(0, -(config.baseHostname.length + 1));
  if (label.includes(".")) return invalid;
  const subdomain = parseCatalogSubdomain(label);
  return subdomain.success ? { kind: "store", subdomain: subdomain.data } : invalid;
}
