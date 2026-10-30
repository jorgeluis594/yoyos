import type { EvalCaseInput, ImageExpectation } from "@core/evals/cases/schema";
import type { ImageManifest, ManifestEntry } from "@core/evals/fixtures/image-manifest";
import type { ProductKey } from "@core/evals/fixtures/catalog";

/**
 * Image identification: the real cascade over the manifest photos (fixtures/images/README.md).
 */

/** CC0 fixtures that already live in the repository (images/README.md), run whatever the manifest holds. */
const staticImageCases: readonly EvalCaseInput[] = [
  { id: "img-url-qr", pass: "image", criterion: 2, kind: "payment-qr", input: { file: "src/features/products/infrastructure/qr-fixtures/non-uuid-qr.jpg" }, expected: [{ kind: "not_product" }] },
  { id: "img-neg-teapot", pass: "image", criterion: 5, kind: "not-in-catalog", input: { file: "src/features/products/infrastructure/product-matching/embedding-fixtures/product-a-front.jpg" },
    ambiguous: "A museum teapot is not sold here; whether the model calls it a product photo or not, nothing is added.",
    expected: [{ kind: "not_found" }, { kind: "not_product" }] },
];

/** What the cascade must answer for each kind of manifest photo; a QR label is found by its code. */
const expectationOf = (entry: ManifestEntry): ImageExpectation => entry.expected === "not_product" ? { kind: "not_product" }
  : entry.expected === "no_match" ? { kind: "not_found" }
    : entry.expected === "label" && entry.color !== null ? { kind: "found", product: entry.productKey!, color: entry.color }
      : { kind: "found", product: entry.productKey! };

/** Payment screens, selfies, maps and documents are criterion 2; every photo of a product, sold or not, is criterion 5. */
const criterionOf = (entry: ManifestEntry) => entry.expected === "not_product" ? 2 : 5;

const caseIdOf = (entry: ManifestEntry) => {
  const name = `${entry.folder}/${entry.file.split("/").at(-1)!}`;
  return `img-${entry.local ? "local-" : ""}${name.replace(/\.[a-z]+$/i, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
};

/**
 * Founder decision (2026-10-24): the Polo básico and the Polo premium are near-identical plain tees in photos. A buyer photo of either
 * passes as the exact product or as not identified («Producto no reconocido»); only the other polo fails. Tagged `indistinguishable-pair`
 * and reported apart.
 */
const indistinguishablePair: readonly ProductKey[] = ["polo-basico", "polo-premium"];
const inPair = (entry: ManifestEntry) => entry.folder === "customer" && entry.productKey !== null && indistinguishablePair.includes(entry.productKey);

/**
 * Founder decision (2026-10-24): a worn photo in the product's second color (`color_variant_worn`) is a known limitation while the
 * catalog indexes one photo per product, in one color; a photo per color is a separate task. Reported apart, never scored.
 */
const secondColor = (entry: ManifestEntry) => entry.scenario === "color_variant_worn";

/**
 * One image case per manifest photo (fixtures/image-manifest.ts) except the `catalog/` ones: those are what the seller uploads and are
 * indexed, so as queries they would match their own embedding. The first photo of each expected answer, and the first worn photo,
 * also run for consistency, so a new manifest keeps the repeated subset small and stable.
 */
export function imageCasesFrom(manifest: ImageManifest | null): readonly EvalCaseInput[] {
  if (!manifest) return staticImageCases;
  const queries = manifest.entries.filter(({ folder }) => folder !== "catalog");
  const repeated = new Set(["match", "no_match", "not_product", "label"].map((expected) => queries.find((entry) => entry.expected === expected))
    .concat(queries.find(({ scenario }) => scenario === "worn")).filter(Boolean));
  const fromManifest = queries.map((entry): EvalCaseInput => ({
    id: caseIdOf(entry), pass: "image", criterion: criterionOf(entry), kind: entry.scenario,
    tags: [`folder:${entry.folder}`, ...(entry.local ? ["local"] : []), ...(inPair(entry) ? ["indistinguishable-pair"] : []),
      ...(secondColor(entry) ? ["known-limitation"] : []), ...(repeated.has(entry) ? ["consistency"] : [])],
    input: { file: entry.file }, expected: inPair(entry) ? [expectationOf(entry), { kind: "not_found" }] : [expectationOf(entry)],
  }));
  return [...fromManifest, ...staticImageCases];
}
