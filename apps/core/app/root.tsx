import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useMatches,
} from "react-router";
import { useEffect } from "react";
import { applyColorPreference, applyPreferenceScript, colorSchemeOf } from "@/color-scheme";
import { themeCss } from "@/design-theme";
import "./app.css";
import { isLocale, languageForLocale } from "@/locale";
import { i18nextMiddleware } from "@/middleware/i18next";
import { useTranslation } from "react-i18next";

export default function App() {
  const segment = useLocation().pathname.split("/")[1];
  const { i18n } = useTranslation();
  const language = languageForLocale(segment);
  const colorScheme = colorSchemeOf(useMatches());

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

        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export const middleware = [i18nextMiddleware];
