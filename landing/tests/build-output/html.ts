import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parse, type HTMLElement } from "node-html-parser";
import type { VariantName } from "./variants";

export const pages = ["index.html", "privacidad.html", "404.html"] as const;
export type PageFile = (typeof pages)[number];

export const distPath = (variant: VariantName, file = ""): string =>
  join(fileURLToPath(new URL("./.dist", import.meta.url)), variant, file);

export const readDist = (variant: VariantName, file: string): string => readFileSync(distPath(variant, file), "utf8");

export const distHas = (variant: VariantName, file: string): boolean => existsSync(distPath(variant, file));

export const readPage = (variant: VariantName, file: PageFile): HTMLElement => parse(readDist(variant, file));

export const gzipBytes = (content: string | Buffer): number => gzipSync(content).length;

export function meta(page: HTMLElement, attribute: "name" | "property", value: string): string | undefined {
  return page.querySelector(`meta[${attribute}="${value}"]`)?.getAttribute("content");
}

/** Heading levels in document order. */
export function headingLevels(page: HTMLElement): number[] {
  return page.querySelectorAll("h1, h2, h3, h4, h5, h6").map((heading) => Number(heading.tagName.slice(1)));
}

export function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Bytes of JavaScript a visitor downloads: hashed bundles in _astro plus inline module scripts. */
export function shippedScriptBytes(variant: VariantName): number {
  const bundles = files(distPath(variant, "_astro"))
    .filter((file) => file.endsWith(".js"))
    .reduce((total, file) => total + statSync(file).size, 0);
  const inline = pages.flatMap((file) =>
    readPage(variant, file)
      .querySelectorAll("script")
      .filter((script) => script.getAttribute("type") !== "application/ld+json")
      .map((script) => Buffer.byteLength(script.text)),
  );
  return bundles + inline.reduce((total, size) => total + size, 0);
}

export function scriptElements(page: HTMLElement): HTMLElement[] {
  return page.querySelectorAll("script").filter((script) => script.getAttribute("type") !== "application/ld+json");
}
