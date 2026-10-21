import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseSiteConfig } from "@landing/src/config/site-config";

const required = {
  PUBLIC_SITE_URL: "https://landing.yoyos.lat",
  PUBLIC_WHATSAPP_NUMBER: "51977909427",
};

function parseEnvExample(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(new URL("../../.env.example", import.meta.url), "utf8").split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function failure(env: Record<string, string | undefined>) {
  const result = parseSiteConfig(env);
  if (result.success) throw new Error("expected a failure");
  return result.error;
}

function success(env: Record<string, string | undefined>) {
  const result = parseSiteConfig(env);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

describe("parseSiteConfig", () => {
  test("parses the variables of .env.example into the site configuration", () => {
    const config = success(parseEnvExample());
    expect(config).toEqual({
      siteUrl: "https://landing.yoyos.lat",
      indexing: false,
      whatsapp: { number: "51977909427", demoText: "Hola, quiero una demo de Yoyos" },
      phone: { number: "+51977909427", display: "+51 977 909 427" },
      appLoginUrl: null,
      demoForm: { kind: "disabled" },
      contactEmail: null,
      social: { tiktok: null, instagram: null },
      analyticsEnabled: false,
    });
  });

  test("fails with INVALID_SITE_CONFIG naming PUBLIC_SITE_URL when it is missing, relative or has a path", () => {
    for (const siteUrl of [undefined, "", "/landing", "landing.yoyos.lat", "https://landing.yoyos.lat/app", "https://landing.yoyos.lat/?a=1"]) {
      const error = failure({ ...required, PUBLIC_SITE_URL: siteUrl });
      expect(error.code).toBe("INVALID_SITE_CONFIG");
      expect(error.variables).toEqual(["PUBLIC_SITE_URL"]);
      expect(error.message).toContain("PUBLIC_SITE_URL");
    }
  });

  test("removes the trailing slash from PUBLIC_SITE_URL", () => {
    expect(success({ ...required, PUBLIC_SITE_URL: "https://landing.yoyos.lat/" }).siteUrl).toBe("https://landing.yoyos.lat");
  });

  test("rejects a WhatsApp number with a plus sign, spaces or letters", () => {
    for (const number of ["+51977909427", "51 977 909 427", "5197790942a", "", undefined]) {
      expect(failure({ ...required, PUBLIC_WHATSAPP_NUMBER: number }).variables).toEqual(["PUBLIC_WHATSAPP_NUMBER"]);
    }
  });

  test("uses + and the WhatsApp number as the call number when PUBLIC_PHONE_NUMBER is empty", () => {
    expect(success({ ...required, PUBLIC_PHONE_NUMBER: "" }).phone.number).toBe("+51977909427");
    expect(success(required).phone.number).toBe("+51977909427");
  });

  test("rejects a call number that is not in international format", () => {
    for (const number of ["977909427", "+51 977 909 427", "51977909427"]) {
      expect(failure({ ...required, PUBLIC_PHONE_NUMBER: number }).variables).toEqual(["PUBLIC_PHONE_NUMBER"]);
    }
  });

  test("shows the call number when PUBLIC_PHONE_DISPLAY is empty", () => {
    expect(success({ ...required, PUBLIC_PHONE_DISPLAY: "" }).phone.display).toBe("+51977909427");
    expect(success({ ...required, PUBLIC_PHONE_NUMBER: "+51912345678" }).phone.display).toBe("+51912345678");
  });

  test("treats empty login URL, form action, email and social URLs as absent", () => {
    const config = success({
      ...required,
      PUBLIC_APP_LOGIN_URL: "",
      PUBLIC_DEMO_FORM_ACTION: "  ",
      PUBLIC_CONTACT_EMAIL: "",
      PUBLIC_TIKTOK_URL: "",
      PUBLIC_INSTAGRAM_URL: "",
      PUBLIC_WHATSAPP_DEMO_TEXT: "",
    });
    expect(config.appLoginUrl).toBeNull();
    expect(config.contactEmail).toBeNull();
    expect(config.social).toEqual({ tiktok: null, instagram: null });
    expect(config.whatsapp.demoText).toBeNull();
  });

  test("disables the demo form when PUBLIC_DEMO_FORM_ACTION is empty and enables it with its URL", () => {
    expect(success(required).demoForm).toEqual({ kind: "disabled" });
    expect(success({ ...required, PUBLIC_DEMO_FORM_ACTION: "https://crm.example.test/demo" }).demoForm).toEqual({
      kind: "enabled",
      action: "https://crm.example.test/demo",
    });
  });

  test("turns indexing and analytics off when their variables are empty", () => {
    const config = success({ ...required, PUBLIC_INDEXING: "", PUBLIC_ANALYTICS_ENABLED: "" });
    expect(config.indexing).toBe(false);
    expect(config.analyticsEnabled).toBe(false);
    const enabled = success({ ...required, PUBLIC_INDEXING: "true", PUBLIC_ANALYTICS_ENABLED: "true" });
    expect(enabled.indexing).toBe(true);
    expect(enabled.analyticsEnabled).toBe(true);
  });

  test("rejects PUBLIC_INDEXING values other than true or false", () => {
    for (const value of ["1", "yes", "TRUE", "on"]) {
      expect(failure({ ...required, PUBLIC_INDEXING: value }).variables).toEqual(["PUBLIC_INDEXING"]);
    }
  });

  test("lists every invalid variable in one error", () => {
    const error = failure({
      PUBLIC_SITE_URL: "nope",
      PUBLIC_WHATSAPP_NUMBER: "+51",
      PUBLIC_INDEXING: "maybe",
      PUBLIC_CONTACT_EMAIL: "not-an-email",
      PUBLIC_TIKTOK_URL: "http://tiktok.example.test/yoyos",
    });
    expect(error.variables).toEqual([
      "PUBLIC_SITE_URL",
      "PUBLIC_INDEXING",
      "PUBLIC_WHATSAPP_NUMBER",
      "PUBLIC_CONTACT_EMAIL",
      "PUBLIC_TIKTOK_URL",
    ]);
  });
});
