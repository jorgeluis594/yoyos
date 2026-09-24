import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import designTokens from "../../../docs/design-tokens.json";
import "./app.css";
import { isLocale } from "@/locale";

const cssVariables = (colors: Record<string, string>) =>
  Object.entries(colors).map(([name, value]) => `--${name}:${value};`).join("");

const themeCss = `:root{${cssVariables(designTokens.colors.light)}--radius-control:${designTokens.radius.control}px;--radius-card:${designTokens.radius.card}px;--radius-overlay:${designTokens.radius.overlay}px;--content-max-width:${designTokens.layout.contentMaxWidth}px}.dark{${cssVariables(designTokens.colors.dark)}}`;

const themeScript = `const preference = localStorage.getItem('yoyos-theme');
document.documentElement.classList.toggle('dark', preference === 'dark' || (!preference && matchMedia('(prefers-color-scheme: dark)').matches));`;

export default function App() {
  const segment = useLocation().pathname.split("/")[1];
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
