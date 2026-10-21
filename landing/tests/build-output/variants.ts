export type VariantName = "minimal" | "full";

export const siteUrl = "https://landing.example.test";

const required = {
  PUBLIC_SITE_URL: siteUrl,
  PUBLIC_WHATSAPP_NUMBER: "51912345678",
  PUBLIC_WHATSAPP_DEMO_TEXT: "Hola, quiero una demo de Yoyos",
  PUBLIC_PHONE_NUMBER: "+51912345678",
  PUBLIC_PHONE_DISPLAY: "+51 912 345 678",
};

/** Every variable is set explicitly, so the builds do not depend on a local .env file. */
export const variants: Record<VariantName, Record<string, string>> = {
  minimal: {
    ...required,
    PUBLIC_INDEXING: "false",
    PUBLIC_ANALYTICS_ENABLED: "false",
    PUBLIC_APP_LOGIN_URL: "",
    PUBLIC_DEMO_FORM_ACTION: "",
    PUBLIC_CONTACT_EMAIL: "",
    PUBLIC_TIKTOK_URL: "",
    PUBLIC_INSTAGRAM_URL: "",
  },
  full: {
    ...required,
    PUBLIC_INDEXING: "true",
    PUBLIC_ANALYTICS_ENABLED: "true",
    PUBLIC_APP_LOGIN_URL: "https://app.example.test/login",
    PUBLIC_DEMO_FORM_ACTION: "https://crm.example.test/demo",
    PUBLIC_CONTACT_EMAIL: "hola@example.test",
    PUBLIC_TIKTOK_URL: "https://www.tiktok.com/@yoyos-test",
    PUBLIC_INSTAGRAM_URL: "https://www.instagram.com/yoyos-test",
  },
};
