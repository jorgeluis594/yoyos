import sharp from "sharp";
import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ChooseProduct } from "@core/src/features/products/application/identify-products-in-image";
import { parseMatchConfidence, type ImageBytes, type VisualChoice } from "@core/src/features/products/domain/image-identification";

// Shared by every provider so their choices and confidences stay comparable.
export type ChooserInput = Parameters<ChooseProduct>[0];
export type ChooserError = Readonly<{ code: "PRODUCT_MATCHER_UNAVAILABLE" | "INVALID_MATCHER_RESPONSE"; message: string }>;
export type PromptPart = Readonly<{ kind: "text"; text: string }> | Readonly<{ kind: "image"; image: ImageBytes }>;
export type ChooserPrompt = Readonly<{ instructions: string; labels: readonly string[]; parts: readonly PromptPart[] }>;

export const NONE = "none";
export const MAX_CANDIDATES = 26;
const MAX_SIDE = 1024;

export const SHOWS_PRODUCT = "shows_product";
// The answer gates every visual match, so it names what a buyer's product photo can look like as well as what is not one.
export const showsProductInstructions = "The first image's main subject is an item a shop could sell, such as clothing, footwear or an accessory: "
  + "photographed alone, worn (often without the face), held, on a screen, in a screenshot of a social media post, or dark, blurry or cropped. "
  + "False when its main subject is a person's face (a selfie or portrait, whatever they wear), a building, house, street or place, "
  + "a payment or transfer, a chat, a map, a receipt, a document or a meme.";

export const chooserInstructions = "The first image was sent by a customer. Decide which candidate product image shows the same product "
  + "(same item, design and colour; ignore background, lighting, angle, overlays and text). "
  + `Answer with the candidate label, or "${NONE}" if no candidate is clearly the same product.`;

export const labelFor = (index: number) => String.fromCharCode(65 + index);

async function resize(image: ImageBytes): Promise<ImageBytes> {
  const bytes = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { bytes: new Uint8Array(bytes), contentType: "image/jpeg" };
}

/** Labels candidates A, B, … in order; product names are never sent. */
export async function buildChooserPrompt(input: ChooserInput): Promise<Result<ChooserPrompt, ChooserError>> {
  if (!input.candidates.length || input.candidates.length > MAX_CANDIDATES) return err({ code: "INVALID_MATCHER_RESPONSE", message: "Unsupported number of candidates" });
  let images: ImageBytes[];
  try { images = await Promise.all([input.query, ...input.candidates.map(({ image }) => image)].map(resize)); }
  catch { return err({ code: "INVALID_MATCHER_RESPONSE", message: "Unable to prepare images" }); }
  const [query, ...candidates] = images as [ImageBytes, ...ImageBytes[]];
  const labels = candidates.map((_, index) => labelFor(index));
  return ok({ instructions: chooserInstructions, labels, parts: [
    { kind: "text", text: "Customer image:" }, { kind: "image", image: query },
    ...candidates.flatMap((image, index): PromptPart[] => [{ kind: "text", text: `Candidate ${labels[index]}:` }, { kind: "image", image }]),
  ] });
}

export function chooserOutputSchema(labels: readonly string[]) {
  return z.strictObject({ choice: z.union([z.enum(labels as [string, ...string[]]), z.literal(NONE)]), confidence: z.number().min(0).max(1), showsProduct: z.number().min(0).max(1) });
}

/** Maps the provider's structured output back to a product of the candidates. */
export function parseChooserOutput(output: unknown, input: ChooserInput, labels: readonly string[]): Result<VisualChoice, ChooserError> {
  const parsed = chooserOutputSchema(labels).safeParse(output);
  if (!parsed.success) return err({ code: "INVALID_MATCHER_RESPONSE", message: "Unexpected matcher output" });
  const confidence = parseMatchConfidence(parsed.data.confidence);
  if (parsed.data.choice === NONE && confidence !== null) return ok({ kind: "none", confidence, showsProduct: parsed.data.showsProduct });
  const candidate = input.candidates[labels.indexOf(parsed.data.choice)];
  return candidate && confidence !== null ? ok({ kind: "product", productId: candidate.productId, confidence, showsProduct: parsed.data.showsProduct })
    : err({ code: "INVALID_MATCHER_RESPONSE", message: "Unexpected matcher output" });
}

export const toDataUrl = (image: ImageBytes) => `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
