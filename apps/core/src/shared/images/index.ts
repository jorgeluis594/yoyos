import { getImage, readImageBytes as readBytes } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";

const storage = createR2ImageStorage({ endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "", privateBucket: process.env.R2_PRIVATE_BUCKET ?? "", accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "", publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "" });

export async function findAvailablePublicImage(id: string) {
  const found = await imageRepository.find(id);
  return found.success ? { success: true as const, data: found.data?.visibility !== "private" ? found.data?.id ?? null : null } : found;
}

export const resolvePublicImage = (id: string) => getImage(id, storage, imageRepository);

export const readImageBytes = (imageId: string) => readBytes(imageId, storage, imageRepository);

export type { ImageReadError } from "@core/src/shared/images/application/images";
export type { DownloadedImage } from "@core/src/shared/images/application/images";
