import { createInstance } from "i18next";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { HydratedRouter } from "react-router/dom";
import { languageForLocale } from "@/locale";
import resources from "@/locales";

async function hydrate() {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: languageForLocale(document.documentElement.lang),
    fallbackLng: "es",
    supportedLngs: Object.keys(resources),
    resources,
  });

  startTransition(() => {
    hydrateRoot(
      document,
      <I18nextProvider i18n={i18n}>
        <StrictMode>
          <HydratedRouter />
        </StrictMode>
      </I18nextProvider>,
    );
  });
}

void hydrate();
