import { initReactI18next } from "react-i18next";
import { createI18nextMiddleware } from "remix-i18next/middleware";
import { languageForLocale } from "@/locale";
import resources from "@/locales";

export const [i18nextMiddleware, getLocale, getInstance] = createI18nextMiddleware({
  detection: {
    supportedLanguages: ["es", "pt"],
    fallbackLanguage: "es",
    async findLocale(request) {
      const locale = new URL(request.url).pathname.split("/")[1] ?? "";
      return languageForLocale(locale);
    },
  },
  i18next: { resources },
  plugins: [initReactI18next],
});
