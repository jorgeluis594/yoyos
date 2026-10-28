import OpenAI, { APIConnectionError, APIError } from "openai";
import sharp from "sharp";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import type { EmbedImage } from "@core/src/features/products/application/index-product-photos";
import { parseEmbeddingModel, parseEmbeddingVector, type EmbeddingModel, type ImageBytes } from "@core/src/features/products/domain/image-identification";

// OpenAI has no image embedding endpoint: a vision model describes the product and a text model embeds the description.
// store: false keeps product photos and customer screenshots out of OpenAI's stored responses (docs/image-product-search.md).
const dimensions = 1536;
const describePrompt = "Describe the product shown in this image so it can be matched against catalog photos: "
  + "category, shape, colors, materials, patterns, printed text or logos and distinctive details. "
  + "Ignore the background, people, hands, prices and app interface elements. Answer in English in at most 80 words, without preamble.";

export type OpenAiImageEmbedderOptions = Readonly<{ client: OpenAI; describeModel: string; embedModel: string; currentCompanyId: () => string }>;

async function toJpeg(image: ImageBytes) {
  const bytes = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

function failure(cause: unknown) {
  // 429, 5xx, timeouts and network errors are transient; other 4xx mean a wrong model or key.
  const status = cause instanceof APIError ? cause.status : undefined;
  const transient = cause instanceof APIConnectionError || status === undefined || status === 429 || status >= 500;
  return { code: transient ? "EMBEDDER_UNAVAILABLE" as const : "INVALID_EMBEDDING" as const, httpStatus: status };
}

export function createOpenAiImageEmbedder(options: OpenAiImageEmbedderOptions): Readonly<{ model: EmbeddingModel; embedImage: EmbedImage }> {
  const model = parseEmbeddingModel(`openai/${options.describeModel}+${options.embedModel}`);
  if (!model) throw new Error("Invalid IMAGE_DESCRIBE_MODEL or IMAGE_EMBEDDER_MODEL");
  const embedImage: EmbedImage = async (image) => {
    const started = performance.now();
    const fail = (code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING", message: string, httpStatus?: number, cause?: unknown) => {
      log.warn({ event: "product_image_embedding_failed", companyId: options.currentCompanyId(), model, errorCode: code, httpStatus,
        durationMs: Math.round(performance.now() - started), err: cause }, "product_image_embedding_failed");
      return err({ code, message });
    };
    let imageUrl: string;
    try { imageUrl = await toJpeg(image); }
    catch (cause) { return fail("INVALID_EMBEDDING", "Image cannot be decoded", undefined, cause); }
    let values: number[];
    try {
      const described = await options.client.responses.create({ model: options.describeModel, store: false, input: [{ role: "user", content: [
        { type: "input_text", text: describePrompt }, { type: "input_image", image_url: imageUrl, detail: "auto" }] }] });
      const description = described.output_text.trim();
      if (!description) return fail("EMBEDDER_UNAVAILABLE", "Vision model returned no description");
      const embedded = await options.client.embeddings.create({ model: options.embedModel, input: description, dimensions, encoding_format: "float" });
      values = embedded.data[0]?.embedding ?? [];
    } catch (cause) {
      const { code, httpStatus } = failure(cause);
      return fail(code, "Embedding provider request failed", httpStatus, cause);
    }
    const vector = parseEmbeddingVector(values, dimensions);
    return vector ? ok(vector) : fail("INVALID_EMBEDDING", "Embedding has an unexpected length or non-finite values");
  };
  return { model, embedImage };
}
