import type { Result } from "@shared/result";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export interface ImageStorage {
  upload(input: { bytes: Uint8Array; filename: string; contentType: string }): Promise<Result<{ key: string }>>;
  uploadPrivate(key: string, input: { bytes: Uint8Array; contentType: string }): Promise<Result<void>>;
  readPrivate(key: string): Promise<Result<{ bytes: Uint8Array; contentType: string }>>;
  getUrl(key: string): Promise<Result<string>>;
  delete(key: string): Promise<Result<void>>;
}

export type ImageLookupError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type StoredImage = Readonly<{ id: string; storageKey: string; visibility?: "public" | "private" }>;

export type ImageRepository = {
  create(storageKey: string): Promise<Result<{ id: string }>>;
  find(id: string): Promise<Result<StoredImage | null, ImageLookupError>>;
  /** Looks up several images in one query; missing IDs are simply absent from the result. */
  findMany(ids: readonly string[]): Promise<Result<readonly StoredImage[], ImageLookupError>>;
  findCompletedImport(companyId: string, sourceKey: string): Promise<Result<{ id: string } | null, ImageLookupError>>;
  reserveImport(companyId: string, sourceKey: string): Promise<Result<{ id: string; storageKey: string }>>;
  completeImport(companyId: string, id: string): Promise<Result<void>>;
};

export type DownloadedImage = Readonly<{ bytes: Uint8Array; filename: string; declaredContentType: string }>;
export type PrivateImageError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR"; message: string }>;

export function findCompletedPrivateImageImport(companyId: string, sourceKey: string, repository: ImageRepository): Promise<Result<{ id: string } | null, ImageLookupError>> {
  return repository.findCompletedImport(companyId, sourceKey);
}

export async function validateImage(file: DownloadedImage): Promise<Result<{ contentType: string }, PrivateImageError>> {
  if (!file.bytes.length || file.bytes.length > 10_000_000) return { success: false, error: { code: file.bytes.length ? "IMAGE_TOO_LARGE" : "INVALID_IMAGE", message: "Invalid image size" } };
  try {
    const detected = await fileTypeFromBuffer(file.bytes);
    if (!detected || detected.mime !== file.declaredContentType || !["image/jpeg", "image/png", "image/webp"].includes(detected.mime)) return { success: false, error: { code: "INVALID_IMAGE", message: "Unsupported image" } };
    const metadata = await sharp(file.bytes, { limitInputPixels: false, failOn: "warning" }).metadata();
    const { width, height, pages } = metadata;
    if (!width || !height || (pages ?? 1) > 1) return { success: false, error: { code: "INVALID_IMAGE", message: "Invalid image data" } };
    if (width > 8_000 || height > 8_000 || width * height > 24_000_000) return { success: false, error: { code: "IMAGE_TOO_LARGE", message: "Image exceeds size limits" } };
    await sharp(file.bytes, { limitInputPixels: 24_000_000, failOn: "warning" }).stats();
    return { success: true, data: { contentType: detected.mime } };
  } catch {
    return { success: false, error: { code: "INVALID_IMAGE", message: "Invalid image data" } };
  }
}

export async function importPrivateImage(companyId: string, sourceKey: string, file: DownloadedImage, storage: ImageStorage, repository: ImageRepository): Promise<Result<{ id: string }>> {
  const valid = await validateImage(file);
  if (!valid.success) return valid;
  const reserved = await repository.reserveImport(companyId, sourceKey);
  if (!reserved.success) return reserved;
  const uploaded = await storage.uploadPrivate(reserved.data.storageKey, { bytes: file.bytes, contentType: valid.data.contentType });
  if (!uploaded.success) return uploaded;
  const completed = await repository.completeImport(companyId, reserved.data.id);
  return completed.success ? { success: true, data: { id: reserved.data.id } } : completed;
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
  if (image.data.visibility === "private") return { success: false, error: { code: "PRIVATE_IMAGE", message: "Private image requires authorized streaming" } };
  const url = await storage.getUrl(image.data.storageKey);
  return url.success
    ? { success: true, data: { id: image.data.id, url: url.data } }
    : url;
}

export type ImageUrl = Readonly<{ id: string; url: string }>;
export type ImageUrlFailure = Readonly<{ id: string; code: string; message: string }>;
export type ResolvedImages = Readonly<{ images: readonly ImageUrl[]; failures: readonly ImageUrlFailure[] }>;

async function publicUrl(image: StoredImage, storage: ImageStorage): Promise<Result<ImageUrl, ImageUrlFailure>> {
  if (image.visibility === "private") return { success: false, error: { id: image.id, code: "PRIVATE_IMAGE", message: "Private image requires authorized streaming" } };
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
    const result = configFailure && image.visibility !== "private"
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

export async function readPrivateImage(id: string, storage: ImageStorage, repository: ImageRepository) {
  const image = await repository.find(id);
  if (!image.success) return image;
  if (!image.data || image.data.visibility !== "private") return { success: true as const, data: null };
  return storage.readPrivate(image.data.storageKey);
}
