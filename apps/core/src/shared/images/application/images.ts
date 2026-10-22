import type { Result } from "@shared/result";
import { imageUploadLimits } from "@shared/contracts/images";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export interface ImageStorage {
  upload(input: { bytes: Uint8Array; filename: string; contentType: string }): Promise<Result<{ key: string }>>;
  read(key: string): Promise<Result<{ bytes: Uint8Array; contentType: string }>>;
  getUrl(key: string): Promise<Result<string>>;
  delete(key: string): Promise<Result<void>>;
}

export type ImageLookupError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type StoredImage = Readonly<{ id: string; storageKey: string }>;

export type ImageRepository = {
  create(storageKey: string): Promise<Result<{ id: string }>>;
  find(id: string): Promise<Result<StoredImage | null, ImageLookupError>>;
  /** Looks up several images in one query; missing IDs are simply absent from the result. */
  findMany(ids: readonly string[]): Promise<Result<readonly StoredImage[], ImageLookupError>>;
};

export type DownloadedImage = Readonly<{ bytes: Uint8Array; filename: string; declaredContentType: string }>;
export type ImageValidationError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR"; message: string }>;

export async function validateImage(file: DownloadedImage): Promise<Result<{ contentType: string; width: number; height: number }, ImageValidationError>> {
  if (!file.bytes.length || file.bytes.length > imageUploadLimits.maxBytes) return { success: false, error: { code: file.bytes.length ? "IMAGE_TOO_LARGE" : "INVALID_IMAGE", message: "Invalid image size" } };
  try {
    const detected = await fileTypeFromBuffer(file.bytes);
    if (!detected || detected.mime !== file.declaredContentType || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) return { success: false, error: { code: "INVALID_IMAGE", message: "Unsupported image" } };
    const metadata = await sharp(file.bytes, { limitInputPixels: false, failOn: "warning" }).metadata();
    const { width, height, pages } = metadata;
    if (!width || !height || (pages ?? 1) > 1) return { success: false, error: { code: "INVALID_IMAGE", message: "Invalid image data" } };
    if (width > imageUploadLimits.maxSide || height > imageUploadLimits.maxSide || width * height > imageUploadLimits.maxPixels) return { success: false, error: { code: "IMAGE_TOO_LARGE", message: "Image exceeds size limits" } };
    await sharp(file.bytes, { limitInputPixels: imageUploadLimits.maxPixels, failOn: "warning" }).stats();
    return { success: true, data: { contentType: detected.mime, width, height } };
  } catch {
    return { success: false, error: { code: "INVALID_IMAGE", message: "Invalid image data" } };
  }
}

async function compensate(storage: ImageStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch { /* Preserve the original failure; the storage adapter reports its own failures. */ }
}

export async function uploadImage(
  input: { bytes: Uint8Array; filename: string; contentType: string },
  storage: ImageStorage,
  repository: ImageRepository,
): Promise<Result<{ id: string; url: string }>> {
  const uploaded = await storage.upload(input);
  if (!uploaded.success) return uploaded;
  const key = uploaded.data.key;
  try {
    const url = await storage.getUrl(key);
    if (!url.success) {
      await compensate(storage, key);
      return url;
    }
    const image = await repository.create(key);
    if (!image.success) {
      await compensate(storage, key);
      return image;
    }
    return { success: true, data: { id: image.data.id, url: url.data } };
  } catch (error) {
    await compensate(storage, key);
    throw error;
  }
}

export async function getImage(
  id: string,
  storage: ImageStorage,
  repository: ImageRepository,
): Promise<Result<{ id: string; url: string } | null>> {
  const image = await repository.find(id);
  if (!image.success) return image;
  if (!image.data) return { success: true, data: null };
  const url = await storage.getUrl(image.data.storageKey);
  return url.success
    ? { success: true, data: { id: image.data.id, url: url.data } }
    : url;
}

export type ImageUrl = Readonly<{ id: string; url: string }>;
export type ImageUrlFailure = Readonly<{ id: string; code: string; message: string }>;
export type ResolvedImages = Readonly<{ images: readonly ImageUrl[]; failures: readonly ImageUrlFailure[] }>;

async function publicUrl(image: StoredImage, storage: ImageStorage): Promise<Result<ImageUrl, ImageUrlFailure>> {
  const url = await storage.getUrl(image.storageKey);
  return url.success
    ? { success: true, data: { id: image.id, url: url.data } }
    : { success: false, error: { id: image.id, code: url.error.code ?? "IMAGE_STORAGE_UNAVAILABLE", message: url.error.message } };
}

/** Resolves public URLs for several images with one repository lookup; per-image failures keep their own code. */
export async function getImages(ids: readonly string[], storage: ImageStorage, repository: ImageRepository): Promise<Result<ResolvedImages, ImageLookupError>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { success: true, data: { images: [], failures: [] } };
  const found = await repository.findMany(unique);
  if (!found.success) return found;
  const resolved: Result<ImageUrl, ImageUrlFailure>[] = [];
  let configFailure: ImageUrlFailure | undefined;
  for (const image of found.data) {
    // A storage configuration error applies to every public image; asking again would only repeat it.
    const result = configFailure
      ? { success: false as const, error: { ...configFailure, id: image.id } }
      : await publicUrl(image, storage);
    if (!result.success && result.error.code === "IMAGE_STORAGE_CONFIG_ERROR") configFailure = result.error;
    resolved.push(result);
  }
  return {
    success: true,
    data: {
      images: resolved.flatMap((result) => result.success ? [result.data] : []),
      failures: resolved.flatMap((result) => result.success ? [] : [result.error]),
    },
  };
}

export type ImageReadError = Readonly<{
  code: "IMAGE_NOT_FOUND" | "IMAGE_STORAGE_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE";
  message: string;
}>;

/** Lee los bytes de una imagen de la empresa desde el almacenamiento. */
export async function readImageBytes(
  imageId: string,
  storage: ImageStorage,
  repository: ImageRepository,
): Promise<Result<Readonly<{ bytes: Uint8Array; contentType: string }>, ImageReadError>> {
  const image = await repository.find(imageId);
  if (!image.success) return image;
  if (!image.data) return { success: false, error: { code: "IMAGE_NOT_FOUND", message: "Image not found" } };
  const object = await storage.read(image.data.storageKey);
  if (object.success) return object;
  return { success: false, error: { code: object.error.code === "IMAGE_NOT_FOUND" ? "IMAGE_NOT_FOUND" : "IMAGE_STORAGE_UNAVAILABLE", message: object.error.message } };
}
