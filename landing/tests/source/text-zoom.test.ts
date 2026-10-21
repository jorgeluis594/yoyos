import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const globalCss = readFileSync(new URL("../../src/styles/global.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("text zoom reflow", () => {
  test("headings, paragraphs and pill labels wrap long words instead of widening their container", () => {
    const rule = globalCss.match(/([^{}]+)\{[^{}]*overflow-wrap:\s*anywhere[^{}]*\}/);
    const selectors = (rule?.[1] ?? "").split(",").map((selector) => selector.trim());
    expect(selectors).toEqual(expect.arrayContaining(["h1", "h2", "h3", "p", "li", "summary", ".pill-label"]));
  });
});
