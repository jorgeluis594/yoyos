import type { EvalCaseInput } from "@core/evals/cases/schema";
import { pickPhoto, type ImageManifest, type PhotoPick } from "@core/evals/fixtures/image-manifest";
import { after, kept, line, L_NEGRO, M_NEGRO } from "@core/evals/cases/builders";

/**
 * End-to-end pass: real photos through the identification cascade, interpretation and the order transaction (apply-chat-message).
 * Photos are picked from the manifest by what they show; a case whose photo the manifest lacks is left out of the run.
 */

const polo = line("polo-basico", M_NEGRO);

/** The Polo básico and premium look alike in photos (founder rule, cases/identification.ts): «Producto no reconocido» is also right. */
const pairNotIdentified = { outcomes: ["not_identified" as const] };

/** Stands for a photo the manifest does not have; its case is dropped. */
const missingPhoto = { file: "-" } as const;

export function endToEndCasesFrom(manifest: ImageManifest | null): readonly EvalCaseInput[] {
  const photo = (pick: PhotoPick) => {
    const entry = manifest ? pickPhoto(manifest, pick) : null;
    return entry ? { file: entry.file } : missingPhoto;
  };
  return endToEndTable(photo).filter((testCase) => testCase.pass === "image" || testCase.pass === "conversation" || testCase.input.photo !== missingPhoto);
}

/** Every end-to-end case id, with or without its photo. */
export const endToEndCaseIds = () => endToEndTable(() => missingPhoto).map(({ id }) => id);

const endToEndTable = (photo: (pick: PhotoPick) => Readonly<{ file: string }>): readonly EvalCaseInput[] => [
  { id: "e2e-photo-worn-caption", pass: "end_to_end", criterion: 5, kind: "photo-caption", tags: ["indistinguishable-pair"],
    input: { photo: photo({ folder: "customer", productKey: "polo-basico", scenario: "worn" }), caption: "talla M negro porfa" },
    expected: [{ outcomes: ["added"], order: [after("polo-basico", M_NEGRO)] }, pairNotIdentified] },
  { id: "e2e-photo-variant-missing", pass: "end_to_end", criterion: 5, kind: "photo", input: { photo: photo({ folder: "customer", productKey: "gorra-trucker", scenario: "in_hand" }) },
    expected: [{ outcomes: ["variant_missing"] }] },
  { id: "e2e-photo-single-variant", pass: "end_to_end", criterion: 5, kind: "photo", input: { photo: photo({ folder: "customer", productKey: "chompa-tejida", scenario: "worn" }), order: [polo] },
    expected: [{ outcomes: ["added"], order: [kept(polo), after("chompa-tejida", { Talla: "Única" })] }] },
  { id: "e2e-photo-premium-details", pass: "end_to_end", criterion: 5, kind: "photo-caption", tags: ["indistinguishable-pair"],
    input: { photo: photo({ folder: "customer", productKey: "polo-premium", scenario: "color_variant_worn" }), caption: "2 en L blanco" },
    expected: [{ outcomes: ["added"], order: [after("polo-premium", { Talla: "L", Color: "Blanco" }, 2)] }, pairNotIdentified] },
  { id: "e2e-photo-decline", pass: "end_to_end", criterion: 1, kind: "photo-caption", input: { photo: photo({ folder: "customer", productKey: "polera-capucha", scenario: "in_hand" }), caption: "no lo quiero", order: [polo] },
    expected: [{ outcomes: ["no_intent"] }, { outcomes: ["no_intent"] }] },
  { id: "e2e-yape-caption", pass: "end_to_end", criterion: 2, kind: "payment", input: { photo: photo({ folder: "non-product", hint: "yape" }), caption: "ya te yapeé", order: [polo] },
    expected: [{ outcomes: ["no_intent"] }] },
  { id: "e2e-selfie", pass: "end_to_end", criterion: 2, kind: "selfie", input: { photo: photo({ folder: "non-product", hint: "selfie" }), order: [polo] },
    expected: [{ outcomes: ["no_intent"] }] },
  { id: "e2e-map-request", pass: "end_to_end", criterion: 2, kind: "map", input: { photo: photo({ folder: "non-product", hint: "map" }), caption: "y agrégame una gorra negra", order: [polo] },
    expected: [{ outcomes: ["image_with_request"] }] },
  { id: "e2e-label-other-size", pass: "end_to_end", criterion: 4, kind: "qr-label", input: { photo: photo({ folder: "label", productKey: "polo-basico", color: "Negro" }), caption: "en talla L" },
    expected: [{ outcomes: ["added"], order: [after("polo-basico", L_NEGRO)] }] },
  { id: "e2e-not-in-catalog", pass: "end_to_end", criterion: 5, kind: "not-in-catalog", input: { photo: photo({ folder: "negative", hint: "zapatilla" }), caption: "la quiero en 40" },
    ambiguous: "Sneakers are not sold: «Producto no reconocido», or a non-product image with a request; never an added item.",
    expected: [{ outcomes: ["not_identified"] }, { outcomes: ["image_with_request"] }] },
  { id: "e2e-text-several", pass: "end_to_end", criterion: 4, kind: "several", input: { text: "quiero 2 polos básicos negros M y una gorra trucker roja" },
    expected: [{ outcomes: ["added", "added"], order: [after("polo-basico", M_NEGRO, 2), after("gorra-trucker", { Color: "Rojo" })] }] },
  { id: "e2e-text-price-hint", pass: "end_to_end", criterion: 3, kind: "price-hint", tags: ["consistency"], input: { text: "el polo de 35 en M negro" },
    expected: [{ outcomes: ["added"], order: [after("polo-basico", M_NEGRO, 1, { amount: 35, units: 1 })] }] },
  { id: "e2e-text-two-candidates", pass: "end_to_end", criterion: 3, kind: "two-candidates", input: { text: "quiero una gorra" },
    expected: [{ outcomes: ["not_clear"] }] },
  { id: "e2e-text-five-polos", pass: "end_to_end", criterion: 3, kind: "many-candidates", input: { text: "quiero un polo" },
    ambiguous: "Five polos match «polo»: «Producto no reconocido» or «Producto no claro» both notify the seller; adding one does not.",
    expected: [{ outcomes: ["not_identified"] }, { outcomes: ["not_clear"] }] },
  { id: "e2e-text-nonexistent", pass: "end_to_end", criterion: 3, kind: "nonexistent", input: { text: "quiero una casaca de jean talla M" },
    expected: [{ outcomes: ["not_identified"] }] },
];
