import { z } from "zod";
import { err, ok } from "@shared/functional";
import { internationalPhonePattern } from "@shared/phone";
import type { AppError, Result } from "@shared/result";

export const siteVariableNames = [
  "PUBLIC_SITE_URL",
  "PUBLIC_INDEXING",
  "PUBLIC_WHATSAPP_NUMBER",
  "PUBLIC_WHATSAPP_DEMO_TEXT",
  "PUBLIC_PHONE_NUMBER",
  "PUBLIC_PHONE_DISPLAY",
  "PUBLIC_APP_LOGIN_URL",
  "PUBLIC_DEMO_FORM_ACTION",
  "PUBLIC_CONTACT_EMAIL",
  "PUBLIC_TIKTOK_URL",
  "PUBLIC_INSTAGRAM_URL",
  "PUBLIC_ANALYTICS_ENABLED",
] as const;

export type SiteVariableName = (typeof siteVariableNames)[number];

export type SiteUrl = string & z.BRAND<"SiteUrl">;
export type WhatsappNumber = string & z.BRAND<"WhatsappNumber">;
export type CallNumber = string & z.BRAND<"CallNumber">;

export type DemoFormConfig =
  | Readonly<{ kind: "enabled"; action: string }>
  | Readonly<{ kind: "disabled" }>;

export type SiteConfig = Readonly<{
  siteUrl: SiteUrl;
  indexing: boolean;
  whatsapp: Readonly<{ number: WhatsappNumber; demoText: string | null }>;
  phone: Readonly<{ number: CallNumber; display: string }>;
  appLoginUrl: string | null;
  demoForm: DemoFormConfig;
  contactEmail: string | null;
  social: Readonly<{ tiktok: string | null; instagram: string | null }>;
  analyticsEnabled: boolean;
}>;

export type SiteConfigError = AppError &
  Readonly<{ code: "INVALID_SITE_CONFIG"; variables: readonly SiteVariableName[] }>;

const localhostHosts = new Set(["localhost", "127.0.0.1"]);

function isSecureUrl(value: string, allowLocalHttp: boolean): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol === "https:") return true;
  return allowLocalHttp && url.protocol === "http:" && localhostHosts.has(url.hostname);
}

function isSiteOrigin(value: string, allowLocalHttp: boolean): boolean {
  if (!isSecureUrl(value, allowLocalHttp)) return false;
  const url = new URL(value);
  return url.pathname === "/" && url.search === "" && url.hash === "";
}

const flag = z.enum(["true", "false"]).transform((value) => value === "true");

function createSiteEnvSchema(allowLocalHttp: boolean) {
  const secureUrl = z.string().refine((value) => isSecureUrl(value, false));
  const secureOrLocalUrl = z.string().refine((value) => isSecureUrl(value, allowLocalHttp));
  return z.object({
    PUBLIC_SITE_URL: z
      .string()
      .refine((value) => isSiteOrigin(value, allowLocalHttp))
      .transform((value) => new URL(value).origin as SiteUrl),
    PUBLIC_INDEXING: flag.optional(),
    PUBLIC_WHATSAPP_NUMBER: z.string().regex(/^[1-9]\d{7,14}$/).transform((value) => value as WhatsappNumber),
    PUBLIC_WHATSAPP_DEMO_TEXT: z.string().optional(),
    PUBLIC_PHONE_NUMBER: z.string().regex(internationalPhonePattern).optional(),
    PUBLIC_PHONE_DISPLAY: z.string().optional(),
    PUBLIC_APP_LOGIN_URL: secureOrLocalUrl.optional(),
    PUBLIC_DEMO_FORM_ACTION: secureOrLocalUrl.optional(),
    PUBLIC_CONTACT_EMAIL: z.email().optional(),
    PUBLIC_TIKTOK_URL: secureUrl.optional(),
    PUBLIC_INSTAGRAM_URL: secureUrl.optional(),
    PUBLIC_ANALYTICS_ENABLED: flag.optional(),
  });
}

type SiteEnv = z.output<ReturnType<typeof createSiteEnvSchema>>;

function trimmedValues(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return Object.fromEntries(
    siteVariableNames.map((name) => {
      const value = env[name]?.trim();
      return [name, value === "" ? undefined : value];
    }),
  );
}

function invalidVariables(error: z.ZodError): SiteVariableName[] {
  const failing = new Set(error.issues.map((issue) => issue.path[0]));
  return siteVariableNames.filter((name) => failing.has(name));
}

function buildConfig(env: SiteEnv): SiteConfig {
  const callNumber = (env.PUBLIC_PHONE_NUMBER ?? `+${env.PUBLIC_WHATSAPP_NUMBER}`) as CallNumber;
  const formAction = env.PUBLIC_DEMO_FORM_ACTION;
  return {
    siteUrl: env.PUBLIC_SITE_URL,
    indexing: env.PUBLIC_INDEXING ?? false,
    whatsapp: { number: env.PUBLIC_WHATSAPP_NUMBER, demoText: env.PUBLIC_WHATSAPP_DEMO_TEXT ?? null },
    phone: { number: callNumber, display: env.PUBLIC_PHONE_DISPLAY ?? callNumber },
    appLoginUrl: env.PUBLIC_APP_LOGIN_URL ?? null,
    demoForm: formAction ? { kind: "enabled", action: formAction } : { kind: "disabled" },
    contactEmail: env.PUBLIC_CONTACT_EMAIL ?? null,
    social: { tiktok: env.PUBLIC_TIKTOK_URL ?? null, instagram: env.PUBLIC_INSTAGRAM_URL ?? null },
    analyticsEnabled: env.PUBLIC_ANALYTICS_ENABLED ?? false,
  };
}

export type ParseOptions = Readonly<{
  /** `astro dev` only: accepts http://localhost URLs. Production builds require https everywhere. */
  development?: boolean;
}>;

/** Parses the PUBLIC_* build variables once; values are never echoed, only names. */
export function parseSiteConfig(
  env: Readonly<Record<string, string | undefined>>,
  options: ParseOptions = {},
): Result<SiteConfig, SiteConfigError> {
  const parsed = createSiteEnvSchema(options.development === true).safeParse(trimmedValues(env));
  if (!parsed.success) {
    const variables = invalidVariables(parsed.error);
    return err({
      code: "INVALID_SITE_CONFIG",
      message: `Invalid site configuration. Fix these variables: ${variables.join(", ")}.`,
      variables,
    });
  }
  return ok(buildConfig(parsed.data));
}
