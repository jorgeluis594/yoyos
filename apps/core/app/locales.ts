import type { Resource } from "i18next";

const resources = {
  es: { translation: {} },
  pt: { translation: {} },
} satisfies Resource;

export default resources;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: typeof resources.es;
  }
}
