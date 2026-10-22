import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = new URL("../..", import.meta.url).pathname;
const forbidden = ["977909427", "yoyos.lat"];
const textExtensions = /\.(astro|ts|js|mjs|css|json|md)$/;

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => sourceFiles(join(path, entry)));
}

describe("hard-coded values", () => {
  test("no source file contains the sales phone number or the site domain", () => {
    const files = [...sourceFiles(join(root, "src")), join(root, "astro.config.ts")]
      .filter((file) => textExtensions.test(file))
      .filter((file) => !/\.(test\.ts|fixture\.json)$/.test(file));
    const offenders = files.filter((file) => forbidden.some((value) => readFileSync(file, "utf8").includes(value)));
    expect(offenders).toEqual([]);
  });
});
