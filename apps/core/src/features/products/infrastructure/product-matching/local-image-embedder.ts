import { resolve } from "node:path";
import sharp from "sharp";
import { err, ok } from "@shared/functional";
import { log } from "@core/src/shared/infrastructure/logger";
import type { EmbedImage } from "@core/src/features/products/application/index-product-image";
import { parseEmbeddingModel, parseEmbeddingVector, type EmbeddingModel, type ImageBytes } from "@core/src/features/products/domain/image-identification";

// Runs a CLIP/SigLIP vision encoder in the worker process with onnxruntime-node: one local inference, no key, no image leaves the server.
// Chosen by measurement (design §2). Its repo's transformers.js_config pins fp32 (quantized MobileCLIP loses most of its recall).
// shortcut: MobileCLIP weights are research-only (Apple ML Research Model Terms, design §15), so they are not committed and must not ship;
// replace this default with a commercially licensed model committed under models/ before merge.
export const DEFAULT_LOCAL_IMAGE_MODEL = "Xenova/mobileclip_s0";

export type RgbImage = Readonly<{ data: Uint8Array; width: number; height: number }>;
/** Image feature model loaded once per process; `embed` returns the raw (unnormalized) image features. */
export type ImageFeatureModel = Readonly<{ dimensions: number; embed: (image: RgbImage) => Promise<ArrayLike<number>> }>;
export type LoadImageFeatureModel = (modelId: string) => Promise<ImageFeatureModel>;

export type LocalImageEmbedderOptions = Readonly<{ modelId: string; currentCompanyId: () => string; load?: LoadImageFeatureModel }>;

/** Model files live in apps/core/models/<model id>/ (models/README.md); cwd-relative because the web build bundles this module. */
export const localModelPath = resolve("models");

/** Loads processor and vision tower only from localModelPath; remote downloads are disabled. */
export const loadImageFeatureModel: LoadImageFeatureModel = async (modelId) => {
  // Imported lazily so web, scripts and tests that never embed do not load the native runtime.
  const { AutoModelForImageFeatureExtraction, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.localModelPath = localModelPath;
  const [processor, model] = await Promise.all([AutoProcessor.from_pretrained(modelId), AutoModelForImageFeatureExtraction.from_pretrained(modelId)]);
  // CLIP returns projected image_embeds and SigLIP a pooled output.
  const embed = async ({ data, width, height }: RgbImage) => {
    const outputs = await model(await processor(new RawImage(data, width, height, 3)));
    return (outputs.image_embeds ?? outputs.pooler_output).data as ArrayLike<number>;
  };
  // Model configs do not state the output size consistently, so one probe inference fixes the expected dimension.
  const dimensions = (await embed({ data: new Uint8Array(3), width: 1, height: 1 })).length;
  return { dimensions, embed };
};

async function toRgb(image: ImageBytes): Promise<RgbImage> {
  const { data, info } = await sharp(image.bytes, { limitInputPixels: 24_000_000 }).rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** Unit length so pgvector's cosine distance and the dot product rank the same; zero or non-finite vectors are rejected. */
function normalize(values: ArrayLike<number>): number[] | null {
  const vector = Array.from(values);
  const norm = Math.hypot(...vector);
  return norm > 0 && Number.isFinite(norm) ? vector.map((value) => value / norm) : null;
}

export function createLocalImageEmbedder(options: LocalImageEmbedderOptions): Readonly<{ model: EmbeddingModel; embedImage: EmbedImage }> {
  const model = parseEmbeddingModel(`local/${options.modelId}`);
  if (!model) throw new Error("Invalid IMAGE_EMBEDDER_MODEL");
  const load = options.load ?? loadImageFeatureModel;
  // Concurrent first jobs share one load; a failed load is forgotten so the job retry loads again.
  let loading: Promise<ImageFeatureModel> | null = null;
  const featureModel = () => loading ??= load(options.modelId).catch((cause: unknown) => { loading = null; throw cause; });

  const embedImage: EmbedImage = async (image) => {
    const started = performance.now();
    const fail = (code: "EMBEDDER_UNAVAILABLE" | "INVALID_EMBEDDING", message: string, cause?: unknown) => {
      log.warn({ event: "product_image_embedding_failed", companyId: options.currentCompanyId(), model, errorCode: code,
        durationMs: Math.round(performance.now() - started), err: cause }, "product_image_embedding_failed");
      return err({ code, message });
    };
    let rgb: RgbImage;
    try { rgb = await toRgb(image); }
    catch (cause) { return fail("INVALID_EMBEDDING", "Image cannot be decoded", cause); }
    let loaded: ImageFeatureModel;
    let values: ArrayLike<number>;
    try {
      loaded = await featureModel();
      values = await loaded.embed(rgb);
    } catch (cause) {
      return fail("EMBEDDER_UNAVAILABLE", "Local image model failed", cause);
    }
    const normalized = normalize(values);
    const vector = normalized && parseEmbeddingVector(normalized, loaded.dimensions);
    return vector ? ok(vector) : fail("INVALID_EMBEDDING", "Embedding has an unexpected length or non-finite values");
  };
  return { model, embedImage };
}
