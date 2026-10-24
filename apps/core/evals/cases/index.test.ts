import { describe, expect, test } from "vitest";
import { allCases, baseCases, casesOf, imageManifest, selectCases, withParaphrases } from "@core/evals/cases";
import type { ImageManifest, ManifestEntry } from "@core/evals/fixtures/image-manifest";
import { needsJudge } from "@core/evals/cases/schema";

const entry = (fields: Partial<ManifestEntry> & Pick<ManifestEntry, "file" | "folder" | "scenario" | "expected">): ManifestEntry =>
  ({ productKey: null, color: null, generator: "test", prompt: null, derivedFrom: null, ...fields });

const manifest: ImageManifest = { dir: "/photos", entries: [
  entry({ file: "catalog/polo-basico.jpg", folder: "catalog", productKey: "polo-basico", color: "Negro", scenario: "catalog", expected: "match" }),
  entry({ file: "customer/polo-basico-worn.jpg", folder: "customer", productKey: "polo-basico", color: "Negro", scenario: "worn", expected: "match" }),
  entry({ file: "customer/polo-basico-blanco-worn.jpg", folder: "customer", productKey: "polo-basico", color: "Blanco", scenario: "second-color-worn", expected: "match" }),
  entry({ file: "customer/polo-oversize-repost.jpg", folder: "customer", productKey: "polo-oversize", color: "Verde", scenario: "repost-screenshot", expected: "match" }),
  entry({ file: "negative/polo-cuello-v-rojo.jpg", folder: "negative", scenario: "hard-negative", expected: "no_match" }),
  entry({ file: "non-product/yape-screenshot.jpg", folder: "non-product", scenario: "payment", expected: "not_product" }),
  entry({ file: "label/polo-basico-negro-m.jpg", folder: "label", productKey: "polo-basico", color: "Negro", scenario: "qr-label", expected: "label" }),
] };

describe("eval cases", () => {
  test("every case parses, with unique ids", () => {
    expect(allCases.length).toBeGreaterThanOrEqual(baseCases.length);
  });

  test("a paraphrase keeps the expectations, drops the consistency repeats and points at its base case", () => {
    const base = baseCases.find(({ id }) => id === "int-add-named")!;
    const [, paraphrase] = withParaphrases([base], [{ of: base.id, text: "pásame un polito L negro" }]);

    expect(paraphrase).toMatchObject({ id: `${base.id}~p1`, paraphraseOf: base.id, expected: base.expected, input: { text: "pásame un polito L negro" } });
    expect(paraphrase!.tags).toContain("paraphrase");
  });

  test("no paraphrase repeats its base wording", () => {
    const copies = allCases.filter((testCase) => testCase.paraphraseOf && testCase.pass !== "text" && testCase.pass !== "image").filter((testCase) => {
      const base = allCases.find(({ id }) => id === testCase.paraphraseOf);
      return base?.pass === testCase.pass && "text" in base.input && JSON.stringify(base.input) === JSON.stringify(testCase.input);
    });

    expect(copies.map(({ id }) => id)).toEqual([]);
  });

  test("a paraphrase of an unknown case is rejected", () => {
    expect(() => withParaphrases(baseCases, [{ of: "missing", text: "hola" }])).toThrow("missing");
  });

  test("the cap spreads cases over the passes", () => {
    const selected = selectCases(casesOf(manifest), { maxCases: 8 });

    expect(selected).toHaveLength(8);
    expect(new Set(selected.map(({ pass }) => pass))).toEqual(new Set(["interpretation", "text", "image", "end_to_end"]));
  });

  test("ids select a case with its paraphrases, which can be skipped", () => {
    const id = allCases.find(({ paraphraseOf }) => paraphraseOf)?.paraphraseOf;
    if (!id) return;

    expect(selectCases(allCases, { ids: [id] }).length).toBeGreaterThan(1);
    expect(selectCases(allCases, { ids: [id], skipParaphrases: true }).map(({ id: caseId }) => caseId)).toEqual([id]);
  });

  test("each manifest photo but the indexed catalog ones is an image case scored by its expected answer, with one repeated photo per answer", () => {
    const images = casesOf(manifest).filter(({ pass }) => pass === "image");

    expect(images.find(({ id }) => id === "img-customer-polo-basico-blanco-worn")).toMatchObject({ criterion: 5, kind: "second-color-worn", expected: [{ kind: "found", product: "polo-basico" }, { kind: "not_found" }] });
    expect(images.find(({ id }) => id === "img-customer-polo-oversize-repost")).toMatchObject({ kind: "repost-screenshot", expected: [{ kind: "found", product: "polo-oversize" }] });
    expect(images.find(({ id }) => id === "img-negative-polo-cuello-v-rojo")?.expected).toEqual([{ kind: "not_found" }]);
    expect(images.find(({ id }) => id === "img-non-product-yape-screenshot")).toMatchObject({ criterion: 2, expected: [{ kind: "not_product" }] });
    expect(images.some(({ input }) => "file" in input && input.file.startsWith("catalog/"))).toBe(false);
    expect(images.find(({ id }) => id === "img-label-polo-basico-negro-m")?.expected).toEqual([{ kind: "found", product: "polo-basico", color: "Negro" }]);
    expect(images.filter(({ tags }) => tags.includes("consistency")).map(({ id }) => id).sort()).toEqual(["img-customer-polo-basico-worn",
      "img-label-polo-basico-negro-m", "img-negative-polo-cuello-v-rojo", "img-non-product-yape-screenshot"]);
  });

  test("buyer photos of the near-identical polos accept the exact product or not identified, without a judge", () => {
    const pair = casesOf(manifest).find(({ id }) => id === "img-customer-polo-basico-blanco-worn")!;

    expect(pair).toMatchObject({ tags: expect.arrayContaining(["indistinguishable-pair"]), expected: [{ kind: "found", product: "polo-basico" }, { kind: "not_found" }] });
    expect(needsJudge(pair)).toBe(false);
    expect(casesOf(manifest).find(({ id }) => id === "img-customer-polo-oversize-repost")!.tags).not.toContain("indistinguishable-pair");
  });

  test("end-to-end photos are picked from the manifest, and a case whose photo is missing leaves with its paraphrases", () => {
    const cases = casesOf(manifest);
    const worn = cases.find(({ id }) => id === "e2e-photo-worn-caption");

    expect(worn?.pass === "end_to_end" && worn.input.photo).toEqual({ file: "customer/polo-basico-worn.jpg" });
    expect(cases.some(({ id }) => id === "e2e-label-other-size")).toBe(true);
    expect(cases.some(({ id, paraphraseOf }) => id === "e2e-map-request" || paraphraseOf === "e2e-map-request")).toBe(false);
  });

  test("without a manifest only the photo-free cases and the repository fixtures run", () => {
    const cases = casesOf(null);

    expect(cases.filter(({ pass }) => pass === "image").map(({ id }) => id)).toEqual(["img-url-qr", "img-neg-teapot"]);
    expect(cases.filter(({ pass }) => pass === "end_to_end").every((testCase) => testCase.pass === "end_to_end" && testCase.input.photo === undefined)).toBe(true);
  });

  test.skipIf(!imageManifest)("the committed manifest covers the agreed photo scenarios", () => {
    const scenarios = new Set(imageManifest!.entries.map(({ scenario }) => scenario));

    expect([...scenarios]).toEqual(expect.arrayContaining(["worn", "in_hand", "repost", "screen", "bad", "color_variant_worn"]));
  });
});
