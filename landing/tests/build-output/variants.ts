export type VariantName = "minimal" | "full";

export const siteUrl = "https://landing.example.test";

export const whatsappNumber = "51912345678";
export const demoText = "Hola, quiero una demo de Yoyos";
export const phoneDisplay = "+51 912 345 678";

const required = {
  PUBLIC_SITE_URL: siteUrl,
  PUBLIC_WHATSAPP_NUMBER: whatsappNumber,
};

/** Every variable is set explicitly, so the builds do not depend on a local .env file. */
export const variants: Record<VariantName, Record<string, string>> = {
  minimal: {
    ...required,
    PUBLIC_WHATSAPP_DEMO_TEXT: "",
    PUBLIC_PHONE_NUMBER: "",
    PUBLIC_PHONE_DISPLAY: "",
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
    PUBLIC_WHATSAPP_DEMO_TEXT: demoText,
    PUBLIC_PHONE_NUMBER: `+${whatsappNumber}`,
    PUBLIC_PHONE_DISPLAY: phoneDisplay,
    PUBLIC_INDEXING: "true",
    PUBLIC_ANALYTICS_ENABLED: "true",
    PUBLIC_APP_LOGIN_URL: "https://app.example.test/login",
    PUBLIC_DEMO_FORM_ACTION: "https://crm.example.test/demo",
    PUBLIC_CONTACT_EMAIL: "hola@example.test",
    PUBLIC_TIKTOK_URL: "https://www.tiktok.com/@yoyos-test",
    PUBLIC_INSTAGRAM_URL: "https://www.instagram.com/yoyos-test",
  },
};
