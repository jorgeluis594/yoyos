import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadPrivateData } from "@core/evals/cases/private";

const created: string[] = [];
const folder = (parent: string) => { const dir = mkdtempSync(join(parent, "private-")); created.push(dir); return dir; };
afterEach(() => { for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const catalog = { products: [
  { key: "taza-a", name: "Taza A", variants: [{ attributes: { Color: "Rojo" }, price: 10 }] },
  { key: "taza-b", name: "Taza B", variants: [{ attributes: {}, price: 12 }] },
] };
const cases = [{ id: "pv-a", pass: "interpretation", criterion: 1, kind: "greeting", input: { text: "hola" }, expected: [{ notice: null }] }];

function write(dir: string) {
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
  writeFileSync(join(dir, "cases.json"), JSON.stringify(cases));
}

describe("private eval data", () => {
  test("loads a private catalog and cases from a folder outside the repository and refuses one inside it, also through a symlink", () => {
    const outside = folder(tmpdir());
    write(outside);
    const loaded = loadPrivateData(outside);

    expect(loaded.catalog.products.map(({ key }) => key)).toEqual(["taza-a", "taza-b"]);
    expect(loaded.cases.map(({ id }) => id)).toEqual(["pv-a"]);

    const inside = folder(resolve(import.meta.dirname, "../.."));
    write(inside);
    expect(() => loadPrivateData(inside)).toThrow("outside the repository");

    const link = join(folder(tmpdir()), "link");
    symlinkSync(inside, link);
    expect(() => loadPrivateData(link)).toThrow("outside the repository");

    const linkedFile = folder(tmpdir());
    writeFileSync(join(linkedFile, "catalog.json"), JSON.stringify(catalog));
    symlinkSync(join(inside, "cases.json"), join(linkedFile, "cases.json"));
    expect(() => loadPrivateData(linkedFile)).toThrow("outside the repository");
    expect(() => loadPrivateData("relative/dir")).toThrow("absolute");
  });

  test("rejects a case naming a product outside the private catalog", () => {
    const dir = folder(tmpdir());
    writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { text: "hola", order: [{ product: "polo-basico", variant: {}, quantity: 1 }] } }]));

    expect(() => loadPrivateData(dir)).toThrow("polo-basico");
  });
});
