import type { Result } from "@shared/result";

export interface ImageStorage {
  upload(input: { bytes: Uint8Array; filename: string; contentType: string }): Promise<Result<{ key: string }>>;
  getUrl(key: string): Promise<Result<string>>;
  delete(key: string): Promise<Result<void>>;
}

export type ImageRepository = {
  create(companyId: string, storageKey: string): Promise<{ id: string }>;
  find(companyId: string, id: string): Promise<{ id: string; storageKey: string } | null>;
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
  companyId: string,
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
    const image = await repository.create(companyId, key);
    return { success: true, data: { id: image.id, url: url.data } };
  } catch (error) {
    await compensate(storage, key, error);
    throw error;
  }
}

export async function getImage(
  companyId: string,
  id: string,
  storage: ImageStorage,
  repository: ImageRepository,
): Promise<Result<{ id: string; url: string } | null>> {
  const image = await repository.find(companyId, id);
  if (!image) return { success: true, data: null };
  const url = await storage.getUrl(image.storageKey);
  return url.success
    ? { success: true, data: { id: image.id, url: url.data } }
    : url;
}
