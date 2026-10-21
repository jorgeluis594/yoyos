import { fileURLToPath } from "node:url";
import { build } from "astro";
import { parse, type HTMLElement } from "node-html-parser";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { variants } from "./variants";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outDir = fileURLToPath(new URL("./.dist/hero-image", import.meta.url));
const fixtureModule = fileURLToPath(new URL("./fixtures/hero-image.ts", import.meta.url));

const buildTimeout = 120_000;
const env = { ...variants.minimal, NODE_ENV: "production" };
const previousEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));

let page: HTMLElement;

/** Builds the real home with the hero slot swapped for a fixture image, so no real screenshot is committed. */
beforeAll(async () => {
  Object.assign(process.env, env);
  await build({
    root,
    outDir,
    logLevel: "silent",
    vite: {
      plugins: [{ name: "hero-image-fixture", enforce: "pre", resolveId: (id) => (id.endsWith("src/content/sections/hero-image") || id.endsWith("sections/hero-image.ts") ? fixtureModule : null) }],
    },
  });
  page = parse(readFileSync(`${outDir}/index.html`, "utf8"));
}, buildTimeout);

afterAll(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("hero with a real image", () => {
  test("renders AVIF and WebP sources with an eager, high-priority image and no provisional marker", () => {
    const hero = page.querySelector("#inicio");
    expect(hero?.querySelectorAll("picture source").map((source) => source.getAttribute("type"))).toEqual(["image/avif", "image/webp"]);
    const img = hero?.querySelector("picture img");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("alt")).toBe("Captura de prueba del hero");
    expect(img?.getAttribute("width")).toBe("1080");
    expect(img?.getAttribute("height")).toBe("1350");
    expect(hero?.text).not.toContain("Imagen provisional");
  });

  test("preloads the AVIF candidates with an href taken from the imagesrcset and the picture's sizes", () => {
    const preload = page.querySelector('link[rel="preload"][as="image"]');
    expect(preload?.getAttribute("fetchpriority")).toBe("high");
    expect(preload?.getAttribute("type")).toBe("image/avif");
    const urls = (preload?.getAttribute("imagesrcset") ?? "").split(",").map((candidate) => candidate.trim().split(" ")[0]);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls).toContain(preload?.getAttribute("href"));
    const avif = page.querySelector('#inicio picture source[type="image/avif"]');
    expect(preload?.getAttribute("imagesrcset")).toBe(avif?.getAttribute("srcset"));
    expect(preload?.getAttribute("imagesizes")).toBe(avif?.getAttribute("sizes"));
  });
});
