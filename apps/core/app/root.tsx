import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { themeCss } from "@core/app/design-theme";
import "./app.css";
import { LocalizationContext } from "@core/app/localization";
import { isLocale } from "@core/app/locale";

const themeScript = `const preference = localStorage.getItem('yoyos-theme');
document.documentElement.classList.toggle('dark', preference === 'dark' || (!preference && matchMedia('(prefers-color-scheme: dark)').matches));`;

export default function App() {
  const { pathname } = useLocation();
  const segment = pathname.split("/")[1];
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
        <LocalizationContext value={pathname}><Outlet /></LocalizationContext>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
