import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const srcRoot = new URL("../../src", import.meta.url).pathname;
const adapter = join(srcRoot, "styles", "design-theme.ts");

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => files(join(path, entry)));
}

/** CSS of .css files and of the <style> blocks of .astro files. */
function cssOf(file: string): string {
  const source = readFileSync(file, "utf8");
  if (file.endsWith(".css")) return source;
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
}

const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(|-?\d*\.?\d+(?:px|rem|em|vw|vh|ch)\b/;

describe("style literals", () => {
  test("no color, radius or size literal appears in CSS outside the token adapter", () => {
    const offenders = files(srcRoot)
      .filter((file) => file !== adapter && /\.(css|astro)$/.test(file))
      .flatMap((file) =>
        cssOf(file)
          .split("\n")
          .filter((line) => !/^\s*@(media|supports)\b/.test(line) && literal.test(line))
          .map((line) => `${file.slice(srcRoot.length)}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});
