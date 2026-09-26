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

export type ImageRepository = {
  create(storageKey: string): Promise<Result<{ id: string }>>;
  find(id: string): Promise<Result<{ id: string; storageKey: string; visibility?: "public" | "private" } | null, ImageLookupError>>;
  reserveImport(companyId: string, sourceKey: string): Promise<Result<{ id: string; storageKey: string }>>;
  completeImport(companyId: string, id: string): Promise<Result<void>>;
};

export type DownloadedImage = Readonly<{ bytes: Uint8Array; filename: string; declaredContentType: string }>;
export type PrivateImageError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE" | "INVALID_IMAGE" | "IMAGE_TOO_LARGE" | "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR"; message: string }>;

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

async function compensate(storage: ImageStorage, key: string, cause: unknown): Promise<void> {
  try {
    const result = await storage.delete(key);
    if (!result.success) console.error("Image cleanup failed", { key, cause, error: result.error });
  } catch (error) {
    console.error("Image cleanup failed", { key, cause, error });
  }
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
      await compensate(storage, key, url.error);
      return url;
    }
    const image = await repository.create(key);
    if (!image.success) {
      await compensate(storage, key, image.error);
      return image;
    }
    return { success: true, data: { id: image.data.id, url: url.data } };
  } catch (error) {
    await compensate(storage, key, error);
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

export async function readPrivateImage(id: string, storage: ImageStorage, repository: ImageRepository) {
  const image = await repository.find(id);
  if (!image.success) return image;
  if (!image.data || image.data.visibility !== "private") return { success: true as const, data: null };
  return storage.readPrivate(image.data.storageKey);
}
