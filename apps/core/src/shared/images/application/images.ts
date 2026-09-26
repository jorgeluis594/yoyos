import type { Result } from "@shared/result";

export interface ImageStorage {
  upload(input: { bytes: Uint8Array; filename: string; contentType: string }): Promise<Result<{ key: string }>>;
  getUrl(key: string): Promise<Result<string>>;
  delete(key: string): Promise<Result<void>>;
}

export type ImageLookupError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>;

export type ImageRepository = {
  create(storageKey: string): Promise<Result<{ id: string }>>;
  find(id: string): Promise<Result<{ id: string; storageKey: string } | null, ImageLookupError>>;
};

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
  const url = await storage.getUrl(image.data.storageKey);
  return url.success
    ? { success: true, data: { id: image.data.id, url: url.data } }
    : url;
}
