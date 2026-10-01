import { createContext, useContext } from "react";
import { languageFromPath, localePrefix } from "@core/app/locale";
import { translate } from "@core/app/translations";
export { translate } from "@core/app/translations";

export const LocalizationContext = createContext("");

export function useLocalization() {
  const path = useContext(LocalizationContext);
  const language = languageFromPath(path);
  return {
    t: (message: string, values?: readonly (string | number)[]) => translate(language, message, values),
    href: (target: string) => `${localePrefix(path)}${target}`,
    language,
    dateLocale: language === "pt" ? "pt-BR" : "es-PE",
  };
}
