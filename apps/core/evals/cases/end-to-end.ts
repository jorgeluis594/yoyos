import type { EvalCaseInput } from "@core/evals/cases/schema";
import { pickPhoto, type ImageManifest, type PhotoPick } from "@core/evals/fixtures/image-manifest";
import { after, kept, line, L_NEGRO, M_NEGRO } from "@core/evals/cases/builders";

/**
 * End-to-end pass: real photos through the identification cascade, interpretation and the order transaction (apply-chat-message).
 * Photos are picked from the manifest by what they show; a case whose photo the manifest lacks is left out of the run.
 */

const polo = line("polo-basico", M_NEGRO);

/** Stands for a photo the manifest does not have; its case is dropped. */
const missingPhoto = { file: "-" } as const;

export function endToEndCasesFrom(manifest: ImageManifest | null): readonly EvalCaseInput[] {
  const photo = (pick: PhotoPick) => {
    const entry = manifest ? pickPhoto(manifest, pick) : null;
    return entry ? { file: entry.file } : missingPhoto;
  };
  return endToEndTable(photo).filter((testCase) => testCase.pass === "text" || testCase.pass === "image" || testCase.input.photo !== missingPhoto);
}

/** Every end-to-end case id, with or without its photo. */
export const endToEndCaseIds = () => endToEndTable(() => missingPhoto).map(({ id }) => id);

const endToEndTable = (photo: (pick: PhotoPick) => Readonly<{ file: string }>): readonly EvalCaseInput[] => [
  { id: "e2e-photo-worn-caption", pass: "end_to_end", criterion: 5, kind: "photo-caption", input: { photo: photo({ folder: "customer", productKey: "polo-basico", hint: "worn" }), caption: "talla M negro porfa" },
    expected: [{ tools: ["add_shown_product_with_details"], outcomes: ["added"], order: [after("polo-basico", M_NEGRO)] }] },
  { id: "e2e-photo-variant-missing", pass: "end_to_end", criterion: 5, kind: "photo", input: { photo: photo({ folder: "customer", productKey: "gorra-trucker" }) },
    expected: [{ tools: ["add_shown_product"], outcomes: ["variant_missing"] }] },
  { id: "e2e-photo-single-variant", pass: "end_to_end", criterion: 5, kind: "photo", input: { photo: photo({ folder: "customer", productKey: "chompa-tejida" }), order: [polo] },
    expected: [{ tools: ["add_shown_product"], outcomes: ["added"], order: [kept(polo), after("chompa-tejida", { Talla: "Única" })] }] },
  { id: "e2e-photo-premium-details", pass: "end_to_end", criterion: 5, kind: "photo-caption", input: { photo: photo({ folder: "customer", productKey: "polo-premium" }), caption: "2 en L blanco" },
    expected: [{ tools: ["add_shown_product_with_details"], outcomes: ["added"], order: [after("polo-premium", { Talla: "L", Color: "Blanco" }, 2)] }] },
  { id: "e2e-photo-decline", pass: "end_to_end", criterion: 1, kind: "photo-caption", input: { photo: photo({ folder: "customer", productKey: "polera-capucha" }), caption: "no lo quiero", order: [polo] },
    expected: [{ tools: ["decline_shown_product"], outcomes: ["no_intent"] }, { tools: ["no_intent"], outcomes: ["no_intent"] }] },
  { id: "e2e-yape-caption", pass: "end_to_end", criterion: 2, kind: "payment", input: { photo: photo({ folder: "non-product", hint: "yape" }), caption: "ya te yapeé", order: [polo] },
    expected: [{ tools: ["no_intent"], outcomes: ["no_intent"] }] },
  { id: "e2e-selfie", pass: "end_to_end", criterion: 2, kind: "selfie", input: { photo: photo({ folder: "non-product", hint: "selfie" }), order: [polo] },
    expected: [{ tools: [], outcomes: ["no_intent"] }] },
  { id: "e2e-map-request", pass: "end_to_end", criterion: 2, kind: "map", input: { photo: photo({ folder: "non-product", hint: "map" }), caption: "y agrégame una gorra negra", order: [polo] },
    expected: [{ tools: ["report_request_with_non_product_image"], outcomes: ["image_with_request"] }] },
  { id: "e2e-label-other-size", pass: "end_to_end", criterion: 4, kind: "qr-label", input: { photo: photo({ folder: "label", productKey: "polo-basico", color: "Negro" }), caption: "en talla L" },
    expected: [{ tools: ["add_shown_product_with_details"], outcomes: ["added"], order: [after("polo-basico", L_NEGRO)] }] },
  { id: "e2e-not-in-catalog", pass: "end_to_end", criterion: 5, kind: "not-in-catalog", input: { photo: photo({ folder: "negative", hint: "zapatilla" }), caption: "la quiero en 40" },
    ambiguous: "Sneakers are not sold: «Producto no reconocido», or a non-product image with a request; never an added item.",
    expected: [{ tools: [], outcomes: ["not_identified"] }, { tools: ["report_request_with_non_product_image"], outcomes: ["image_with_request"] }] },
  { id: "e2e-text-several", pass: "end_to_end", criterion: 4, kind: "several", input: { text: "quiero 2 polos básicos negros M y una gorra trucker roja" },
    expected: [{ tools: ["add_products"], outcomes: ["added", "added"], order: [after("polo-basico", M_NEGRO, 2), after("gorra-trucker", { Color: "Rojo" })] }] },
  { id: "e2e-text-price-hint", pass: "end_to_end", criterion: 3, kind: "price-hint", tags: ["consistency"], input: { text: "el polo de 35 en M negro" },
    expected: [{ tools: ["add_products"], outcomes: ["added"], order: [after("polo-basico", M_NEGRO, 1, { amount: 35, units: 1 })] }] },
  { id: "e2e-text-two-candidates", pass: "end_to_end", criterion: 3, kind: "two-candidates", input: { text: "quiero una gorra" },
    expected: [{ tools: ["add_products"], outcomes: ["not_clear"] }] },
  { id: "e2e-text-five-polos", pass: "end_to_end", criterion: 3, kind: "many-candidates", input: { text: "quiero un polo" },
    ambiguous: "Five polos match «polo»: «Producto no reconocido» or «Producto no claro» both notify the seller; adding one does not.",
    expected: [{ tools: ["add_products"], outcomes: ["not_identified"] }, { tools: ["add_products"], outcomes: ["not_clear"] }] },
  { id: "e2e-text-nonexistent", pass: "end_to_end", criterion: 3, kind: "nonexistent", input: { text: "quiero una casaca de jean talla M" },
    expected: [{ tools: ["add_products"], outcomes: ["not_identified"] }] },
];
