import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadPrivateData, privateDirOf } from "@core/evals/cases/private";

const created: string[] = [];
const folder = (parent: string) => { const dir = mkdtempSync(join(parent, "private-")); created.push(dir); return dir; };
afterEach(() => { for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const catalog = { products: [
  { key: "taza-a", name: "Taza A", variants: [{ attributes: { Color: "Rojo" }, price: 10 }] },
  { key: "taza-b", name: "Taza B", variants: [{ attributes: {}, price: 12 }] },
  { key: "taza-c", name: "Taza C", variants: [{ attributes: { Color: "Azul", Tamaño: "Grande" }, price: 14 }, { attributes: { Color: "Azul", Tamaño: "Chico" }, price: 13 }] },
  { key: "taza-vieja", name: "Taza vieja", active: false, variants: [{ attributes: {}, price: 9 }] },
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

    expect(loaded.catalog.products.map(({ key }) => key)).toEqual(["taza-a", "taza-b", "taza-c", "taza-vieja"]);
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

  test("refuses a private folder inside the repository", () => {
    const inside = folder(resolve(import.meta.dirname, "../.."));
    write(inside);

    expect(() => loadPrivateData(inside)).toThrow("EVAL_PRIVATE_DIR must be outside the repository");
    expect(() => privateDirOf(inside)).toThrow("outside the repository");
  });

  test("rejects a case naming a product outside the private catalog", () => {
    const dir = folder(tmpdir());
    writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { text: "hola", order: [{ product: "polo-basico", variant: {}, quantity: 1 }] } }]));

    expect(() => loadPrivateData(dir)).toThrow("names a product the catalog does not have");
    expect(() => loadPrivateData(dir)).not.toThrow("polo-basico");
  });

  test("loads a start with an order on an inactive product, pendings and a closed order, and refuses one the catalog cannot hold", () => {
    const dir = folder(tmpdir());
    writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
    const start = { order: [{ product: "taza-vieja", variant: {}, quantity: 1 }], pendings: [{ product: "taza-c", known: { Color: "Azul" } }, { candidates: ["taza-a", "taza-b"], quantity: 2 }], orderState: "closed" };
    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { text: "hola", ...start } }]));

    expect(loadPrivateData(dir).cases).toHaveLength(1);

    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { text: "hola", pendings: [{ product: "taza-c", known: { Color: "Rojo" } }] } }]));
    expect(() => loadPrivateData(dir)).toThrow("seeds a start the catalog does not have");
    expect(() => loadPrivateData(dir)).not.toThrow("Rojo");

    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { text: "hola", orderState: "closed" } }]));
    expect(() => loadPrivateData(dir)).toThrow("input");
  });

  test("a malformed file names the file and the failing schema paths, never its content or keys", () => {
    const dir = folder(tmpdir());
    const failure = (): string => { try { loadPrivateData(dir); } catch (cause) { return (cause as Error).message; } return ""; };

    writeFileSync(join(dir, "catalog.json"), '{"products": [secret-token');
    writeFileSync(join(dir, "cases.json"), "[]");
    expect(failure()).toBe("catalog.json is not valid JSON or cannot be read");

    writeFileSync(join(dir, "catalog.json"), JSON.stringify({ products: [{ key: "taza-a", name: "Taza secreta", variants: [{ attributes: { Secreto: 3 }, price: 10 }], leakedKey: 1 }] }));
    const message = failure();
    expect(message).toMatch(/^catalog.json is invalid at: /);
    expect(message).toContain("products.0.variants.0.attributes.*");
    for (const leaked of ["Secreto", "secreta", "leakedKey", "taza-a"]) expect(message).not.toContain(leaked);

    writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], id: "pv-dup" }, { ...cases[0], id: "pv-dup" }]));
    expect(failure()).toBe("cases.json repeats a case id");

    writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { text: "quiero la taza secreta", order: "x" }, privateField: "oculto" }]));
    const bad = failure();
    expect(bad).toMatch(/^cases.json is invalid at: /);
    for (const leaked of ["taza secreta", "oculto", "privateField"]) expect(bad).not.toContain(leaked);
  });
});
