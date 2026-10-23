import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useMatches,
  useRouteError,
} from "react-router";
import { useEffect, type ReactNode } from "react";
import { applyColorPreference, applyPreferenceScript, colorSchemeOf } from "@/color-scheme";
import { themeCss } from "@/design-theme";
import "./app.css";
import { isLocale, languageForLocale } from "@/locale";
import { i18nextMiddleware } from "@/middleware/i18next";
import { storefrontMiddleware } from "@/middleware/storefront";
import { storefrontErrorOf } from "@/storefront-error";
import { CatalogLoadError, CatalogMessage, StoreNotFound } from "@/components/catalog-sections";
import { ErrorState } from "@/components/ui/error-state";
import { useTranslation } from "react-i18next";

/** The document for every page, the error pages included: a themed store page keeps its fixed scheme when it is the error. */
export function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const segment = useLocation().pathname.split("/")[1];
  const { i18n } = useTranslation();
  const language = languageForLocale(segment);
  const matches = useMatches();
  const failure = storefrontErrorOf(useRouteError());
  const colorScheme = failure ? (failure.kind === "store_not_found" ? "fixed" : "system") : colorSchemeOf(matches);

  useEffect(() => {
    if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  }, [i18n, language]);

  // Moving between a themed page and the rest of the app in the browser does not reload the head script.
  useEffect(() => {
    let preference: string | null = null;
    try { preference = localStorage.getItem("yoyos-theme"); } catch { /* storage blocked: follow the system */ }
    applyColorPreference(document.documentElement, preference, matchMedia("(prefers-color-scheme: dark)").matches);
  }, [colorScheme]);

  return (
    <html lang={isLocale(segment) ? segment : "es"} data-color-scheme={colorScheme === "fixed" ? "fixed" : undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script dangerouslySetInnerHTML={{ __html: applyPreferenceScript }} />
        <Links />
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>
        {segment === "checkout" && <script type="text/plain" dangerouslySetInnerHTML={{ __html: `<!-- THESIS: Review prepared details, complete delivery and payment.
OWN-WORLD: Caramelo sobrio, Inter, cream, caramel actions, white surfaces and quiet rules.
STORY: Review, confirm, await delivery quote when needed, then pay and send evidence.
FIRST VIEWPORT: Desktop review left and 320px summary right; mobile expandable products above editable rows.
FORM: Review-first, option 3, seed dac33d81.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->` }} />}

        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/** Brand hosts refuse with typed data; anything else keeps a plain page, with the localized text for a missing one. */
export function ErrorBoundary() {
  const error = useRouteError();
  const failure = storefrontErrorOf(error);
  const { t } = useTranslation();
  if (failure?.kind === "store_not_found") return <StoreNotFound storeName={failure.header.storeName} appearance={failure.header.appearance} />;
  if (failure?.kind === "catalog_unavailable") return <CatalogMessage title="Catálogo no disponible" />;
  if (failure?.kind === "catalog_load_error") return <CatalogLoadError />;
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main className="p-6"><ErrorState title={missing ? t("notFoundPage.title") : "Algo salió mal"}
    description={missing ? t("notFoundPage.hint") : "Vuelve a intentarlo en unos minutos."} /></main>;
}

export const middleware = [i18nextMiddleware, storefrontMiddleware];
