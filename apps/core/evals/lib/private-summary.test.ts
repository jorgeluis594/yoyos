import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadPrivateData } from "@core/evals/cases/private";
import { privateSummaryText } from "@core/evals/lib/private-summary";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const catalog = { products: [
  { key: "taza-a", name: "Taza A", variants: [{ attributes: { Color: "Rojo" }, price: 10 }] },
  { key: "taza-b", name: "Taza B", variants: [{ attributes: {}, price: 12 }] },
] };
const secretText = "quiero la taza secreta";
const cases = [
  { id: "pv-secret-photo", pass: "interpretation", criterion: 1, kind: "secret-family", input: { photo: { shows: "not_found" }, caption: secretText }, expected: [{ notice: "not_identified" }] },
  { id: "pv-secret-text", pass: "interpretation", criterion: 1, kind: "other-family", input: { text: secretText }, expected: [{ notice: null }] },
  { id: "pv-secret-chat", pass: "conversation", kind: "secret-family", steps: [
    { input: { photo: { shows: "taza-a" } }, expected: { notice: "variant_missing" } },
    { input: { text: secretText }, expected: { notice: null } }] },
];

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "private-summary-"));
  dirs.push(dir);
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
  writeFileSync(join(dir, "cases.json"), JSON.stringify(cases));
  return dir;
}

test("a private case with a photo described as matched nothing loads and is identified as not found", () => {
  const loaded = loadPrivateData(folder());
  const photoCase = loaded.cases.find(({ id }) => id === "pv-secret-photo");

  expect(photoCase?.pass === "interpretation" && photoCase.input.photo).toEqual({ shows: "not_found" });
});

test("a private case with a photo file is still refused", () => {
  const dir = folder();
  writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { photo: { file: "x.jpg" } } }]));

  expect(() => loadPrivateData(dir)).toThrow("photo files");
});

test("a not-found photo takes no label", () => {
  const dir = folder();
  writeFileSync(join(dir, "cases.json"), JSON.stringify([{ ...cases[0], input: { photo: { shows: "not_found", label: { Color: "Rojo" } } } }]));

  expect(() => loadPrivateData(dir)).toThrow();
});

test("check-private prints counts only", () => {
  const text = privateSummaryText(loadPrivateData(folder()));

  expect(text).toContain("3 cases");
  expect(text).toContain("interpretation 2");
  expect(text).toContain("conversation 1");
  expect(text).toContain("photo cases 2");
  for (const leaked of ["pv-secret", "secret", "taza", "quiero", "family"]) expect(text).not.toContain(leaked);
});
