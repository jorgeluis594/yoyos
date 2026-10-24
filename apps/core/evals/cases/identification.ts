import type { EvalCaseInput, ImageExpectation } from "@core/evals/cases/schema";
import type { ImageManifest, ManifestEntry } from "@core/evals/fixtures/image-manifest";

/**
 * Identification passes. Text: the product words as the extraction model passes them, with the buyer's unit price as a hint
 * (docs/image-product-search.md «Text identification»). Image: the real cascade over the manifest photos (fixtures/images/README.md).
 */

export const textCases: readonly EvalCaseInput[] = [
  // 3. Buyer wording: synonyms, plurals, diminutives, typos, no accents. «gorra» and «polera» have exactly two candidates each.
  // `known-limitation`: beyond the documented design (candidates come from name trigrams, so a synonym sharing no letters is never
  // one); reported apart and left out of the score.
  { id: "txt-polera-two-candidates", pass: "text", criterion: 3, kind: "two-candidates", input: { mention: "polera" }, expected: [{ kind: "not_clear", products: ["polera-capucha", "polera-cuello-redondo"] }] },
  { id: "txt-polera-price", pass: "text", criterion: 3, kind: "price-hint", input: { mention: "polera", priceHint: 89 }, expected: [{ kind: "found", product: "polera-capucha" }] },
  { id: "txt-chompa", pass: "text", criterion: 3, kind: "wording", input: { mention: "chompa" }, expected: [{ kind: "found", product: "chompa-tejida" }] },
  { id: "txt-chompita", pass: "text", criterion: 3, kind: "diminutive", input: { mention: "chompita" }, expected: [{ kind: "found", product: "chompa-tejida" }] },
  { id: "txt-polos-basicos", pass: "text", criterion: 3, kind: "plural", input: { mention: "polos basicos" }, expected: [{ kind: "found", product: "polo-basico" }] },
  { id: "txt-polito-basico", pass: "text", criterion: 3, kind: "diminutive", input: { mention: "polito básico" },
    ambiguous: "«Polo básico niño» is a near-duplicate name; «Producto no claro» between the two is acceptable.",
    expected: [{ kind: "found", product: "polo-basico" }, { kind: "not_clear", products: ["polo-basico", "polo-basico-nino"] }] },
  { id: "txt-polo-five-candidates", pass: "text", criterion: 3, kind: "many-candidates", input: { mention: "polo" },
    ambiguous: "Five polos share the word: the probability spreads so that two rarely reach 0.25, and «Producto no reconocido» notifies the seller as «Producto no claro» does.",
    expected: [{ kind: "not_found" }, { kind: "not_clear" }] },
  { id: "txt-polo-35", pass: "text", criterion: 3, kind: "price-hint", input: { mention: "polo", priceHint: 35 }, expected: [{ kind: "found", product: "polo-basico" }] },
  { id: "txt-polo-55", pass: "text", criterion: 3, kind: "price-hint", input: { mention: "polo", priceHint: 55 }, expected: [{ kind: "found", product: "polo-premium" }] },
  { id: "txt-gorra-two-candidates", pass: "text", criterion: 3, kind: "two-candidates", tags: ["consistency"], input: { mention: "gorra" }, expected: [{ kind: "not_clear", products: ["gorra-trucker", "gorra-snapback"] }] },
  { id: "txt-gorra-30", pass: "text", criterion: 3, kind: "price-hint", input: { mention: "gorra", priceHint: 30 }, expected: [{ kind: "found", product: "gorra-snapback" }] },
  { id: "txt-gorrita-trucker", pass: "text", criterion: 3, kind: "diminutive", input: { mention: "gorrita trucker" }, expected: [{ kind: "found", product: "gorra-trucker" }] },
  { id: "txt-correa", pass: "text", criterion: 3, kind: "wording", input: { mention: "correa" }, expected: [{ kind: "found", product: "correa-cuero" }] },
  { id: "txt-cinturon", pass: "text", criterion: 3, kind: "synonym", input: { mention: "cinturon de cuero" }, expected: [{ kind: "found", product: "correa-cuero" }] },
  { id: "txt-medias", pass: "text", criterion: 3, kind: "wording", input: { mention: "medias" }, expected: [{ kind: "found", product: "medias-pack" }] },
  { id: "txt-calcetines", pass: "text", criterion: 3, kind: "synonym", tags: ["known-limitation"], input: { mention: "calcetines" }, expected: [{ kind: "found", product: "medias-pack" }] },
  { id: "txt-poleron-capucha", pass: "text", criterion: 3, kind: "synonym", input: { mention: "poleron con capucha" }, expected: [{ kind: "found", product: "polera-capucha" }] },
  { id: "txt-premiun-typo", pass: "text", criterion: 3, kind: "typo", input: { mention: "polo premiun" }, expected: [{ kind: "found", product: "polo-premium" }] },
  { id: "txt-oversais-typo", pass: "text", criterion: 3, kind: "typo", input: { mention: "polo oversais" }, expected: [{ kind: "found", product: "polo-oversize" }] },
  { id: "txt-polo-rayas", pass: "text", criterion: 3, kind: "wording", input: { mention: "polo de rayitas" }, expected: [{ kind: "found", product: "polo-rayas" }] },
  { id: "txt-polo-nino", pass: "text", criterion: 3, kind: "near-duplicate", input: { mention: "polo para niño" }, expected: [{ kind: "found", product: "polo-basico-nino" }] },
  // 3. Products the catalog does not sell are never matched to a similar one.
  { id: "txt-casaca", pass: "text", criterion: 3, kind: "nonexistent", input: { mention: "casaca de jean" }, expected: [{ kind: "not_found" }] },
  { id: "txt-zapatillas", pass: "text", criterion: 3, kind: "nonexistent", input: { mention: "zapatillas blancas" }, expected: [{ kind: "not_found" }] },
  { id: "txt-short", pass: "text", criterion: 3, kind: "nonexistent", input: { mention: "short de baño" }, expected: [{ kind: "not_found" }] },
  { id: "txt-polo-manga-larga", pass: "text", criterion: 3, kind: "nonexistent", input: { mention: "polo manga larga" },
    ambiguous: "No long-sleeved polo exists; «Producto no claro» between polos adds nothing and is acceptable, a match is not.",
    expected: [{ kind: "not_found" }, { kind: "not_clear" }] },
  { id: "txt-gorra-lana", pass: "text", criterion: 3, kind: "nonexistent", input: { mention: "gorro de lana" },
    ambiguous: "A wool beanie is not a cap; «Producto no claro» between the caps adds nothing and is acceptable.",
    expected: [{ kind: "not_found" }, { kind: "not_clear" }] },
];

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

const caseIdOf = (file: string) => `img-${file.replace(/\.[a-z]+$/i, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

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
    id: caseIdOf(entry.file), pass: "image", criterion: criterionOf(entry), kind: entry.scenario,
    tags: [`folder:${entry.folder}`, ...(repeated.has(entry) ? ["consistency"] : [])],
    input: { file: entry.file }, expected: [expectationOf(entry)],
  }));
  return [...fromManifest, ...staticImageCases];
}
