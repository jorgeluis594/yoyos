import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  distHas,
  files,
  distPath,
  gzipBytes,
  headingLevels,
  meta,
  pages,
  readDist,
  readPage,
  distScripts,
  scriptElements,
  shippedScriptBytes,
} from "./html";
import { findUnreferencedScripts } from "@landing/src/lib/unreferenced-scripts";
import { siteUrl, type VariantName } from "./variants";

const variantNames: VariantName[] = ["minimal", "full"];
const canonicalOf = (file: (typeof pages)[number]) =>
  file === "index.html" ? `${siteUrl}/` : `${siteUrl}/${file.replace(".html", "")}`;

describe("indexing modes", () => {
  test("with indexing off every page carries noindex, nofollow and robots.txt disallows all", () => {
    for (const file of pages) expect(meta(readPage("minimal", file), "name", "robots")).toBe("noindex, nofollow");
    expect(readDist("minimal", "robots.txt")).toBe("User-agent: *\nDisallow: /\n");
  });

  test("with indexing on every indexable page carries index, follow and robots.txt allows all and names the sitemap index", () => {
    for (const file of ["index.html", "privacidad.html"] as const) {
      expect(meta(readPage("full", file), "name", "robots")).toBe("index, follow");
    }
    expect(readDist("full", "robots.txt")).toBe(`User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap-index.xml\n`);
  });

  test("the 404 page is noindex in both variants", () => {
    for (const variant of variantNames) expect(meta(readPage(variant, "404.html"), "name", "robots")).toBe("noindex, nofollow");
  });

  test("the sitemap lists / and /privacidad and not the 404", () => {
    for (const variant of variantNames) {
      const urls = [...readDist(variant, "sitemap-0.xml").matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
      expect(urls).toEqual([`${siteUrl}/`, `${siteUrl}/privacidad`]);
      expect(readDist(variant, "sitemap-index.xml")).toContain(`${siteUrl}/sitemap-0.xml`);
    }
  });
});

describe("page structure", () => {
  test("every page has exactly one h1 and no skipped heading level", () => {
    for (const variant of variantNames) {
      for (const file of pages) {
        const levels = headingLevels(readPage(variant, file));
        expect(levels.filter((level) => level === 1), `${variant}/${file}`).toHaveLength(1);
        expect(levels[0]).toBe(1);
        levels.slice(1).forEach((level, index) => expect(level, `${variant}/${file}`).toBeLessThanOrEqual(levels[index] + 1));
      }
    }
  });

  test("every page has lang es-PE, a self-referencing canonical, og:url and hreflang es-PE and x-default on the site URL", () => {
    for (const variant of variantNames) {
      for (const file of pages) {
        const page = readPage(variant, file);
        const canonical = canonicalOf(file);
        expect(page.querySelector("html")?.getAttribute("lang")).toBe("es-PE");
        expect(page.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(canonical);
        expect(meta(page, "property", "og:url")).toBe(canonical);
        expect(page.querySelector('link[hreflang="es-PE"]')?.getAttribute("href")).toBe(canonical);
        expect(page.querySelector('link[hreflang="x-default"]')?.getAttribute("href")).toBe(canonical);
        expect(meta(page, "property", "og:image")).toBe(`${siteUrl}/og/yoyos-1200x630.png`);
      }
    }
  });

  test("the home JSON-LD parses and holds Organization, WebSite, SoftwareApplication and FAQPage", () => {
    const script = readPage("full", "index.html").querySelector('script[type="application/ld+json"]');
    const graph = JSON.parse(script?.text ?? "") as { "@graph": { "@type": string }[] };
    expect(graph["@graph"].map((node) => node["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication", "FAQPage"]);
  });

  test("the manifest, favicon, apple-touch-icon and OG image referenced by the head exist in dist", () => {
    for (const variant of variantNames) {
      for (const file of pages) {
        const page = readPage(variant, file);
        const hrefs = [
          page.querySelector('link[rel="manifest"]')?.getAttribute("href"),
          page.querySelector('link[rel="icon"]')?.getAttribute("href"),
          page.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
          meta(page, "property", "og:image")?.replace(siteUrl, ""),
        ];
        for (const href of hrefs) {
          expect(href, `${variant}/${file}`).toBeTruthy();
          expect(distHas(variant, (href as string).replace(/^\//, "")), href).toBe(true);
        }
      }
      const manifest = JSON.parse(readDist(variant, "manifest.webmanifest")) as { icons: { src: string }[] };
      for (const icon of manifest.icons) expect(distHas(variant, icon.src.replace(/^\//, ""))).toBe(true);
    }
  });

  test("every img has alt text and explicit width and height", () => {
    for (const variant of variantNames) {
      for (const file of pages) {
        for (const image of readPage(variant, file).querySelectorAll("img")) {
          expect(image.getAttribute("alt"), `${variant}/${file}`).not.toBeUndefined();
          expect(image.getAttribute("width")).toBeTruthy();
          expect(image.getAttribute("height")).toBeTruthy();
        }
      }
    }
  });
});

describe("budgets", () => {
  test("the shipped JavaScript stays within 50 KB and the home HTML with its CSS within 100 KB gzip", () => {
    for (const variant of variantNames) {
      expect(shippedScriptBytes(variant)).toBeLessThanOrEqual(50 * 1024);
      const stylesheets = files(distPath(variant, "_astro"))
        .filter((file) => file.endsWith(".css"))
        .map((file) => readDist(variant, file.slice(distPath(variant).length + 1)))
        .join("");
      expect(gzipBytes(readDist(variant, "index.html") + stylesheets)).toBeLessThanOrEqual(100 * 1024);
    }
  });

  test("the minimal variant ships no JavaScript and the analytics listener appears only in the full variant", () => {
    expect(distScripts("minimal")).toEqual([]);
    for (const file of pages) {
      expect(scriptElements(readPage("minimal", file))).toHaveLength(0);
      expect(readDist("minimal", file)).not.toMatch(/\.js\b/);
    }
    const listener = (variant: VariantName) => {
      const bundles = files(distPath(variant, "_astro"))
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFileSync(file, "utf8"));
      const inline = scriptElements(readPage(variant, "index.html")).map((script) => script.text);
      return [...bundles, ...inline].filter((code) => /["'`]toggle["'`]/.test(code));
    };
    expect(listener("full")).toHaveLength(1);
    expect(readDist("full", "index.html")).toMatch(/\.js\b|<script/);
  });

  test("the full variant ships only JavaScript that a page loads", () => {
    const root = distPath("full");
    const scripts = Object.fromEntries(distScripts("full").map((file) => [file, readFileSync(join(root, file), "utf8")]));
    const pageSources = pages.map((file) => readDist("full", file));
    expect(Object.keys(scripts).length).toBeGreaterThan(0);
    expect(findUnreferencedScripts(pageSources, scripts)).toEqual([]);
  });
});

describe("light theme only", () => {
  test("pages and stylesheets never follow a dark color-scheme preference and declare the light scheme", () => {
    for (const variant of variantNames) {
      const stylesheets = files(distPath(variant, "_astro")).filter((file) => file.endsWith(".css"));
      for (const file of pages) {
        const html = readDist(variant, file);
        expect(html, `${variant}/${file}`).not.toContain("prefers-color-scheme");
        expect(html, `${variant}/${file}`).toContain("color-scheme:light");
        expect(meta(readPage(variant, file), "name", "color-scheme")).toBe("light");
        expect(readPage(variant, file).querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
        expect(readPage(variant, file).querySelectorAll("picture source[media]")).toHaveLength(0);
      }
      for (const stylesheet of stylesheets) expect(readFileSync(stylesheet, "utf8")).not.toContain("prefers-color-scheme");
    }
  });
});
