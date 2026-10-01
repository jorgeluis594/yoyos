import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useEffect } from "react";
import { themeCss } from "@/design-theme";
import "./app.css";
import { isLocale, languageForLocale } from "@/locale";
import { i18nextMiddleware } from "@/middleware/i18next";
import { useTranslation } from "react-i18next";

const themeScript = `const preference = localStorage.getItem('yoyos-theme');
document.documentElement.classList.toggle('dark', preference === 'dark' || (!preference && matchMedia('(prefers-color-scheme: dark)').matches));`;

export default function App() {
  const segment = useLocation().pathname.split("/")[1];
  const { i18n } = useTranslation();
  const language = languageForLocale(segment);

  useEffect(() => {
    if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  }, [i18n, language]);

  return (
    <html lang={isLocale(segment) ? segment : "es"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Links />
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export const middleware = [i18nextMiddleware];
