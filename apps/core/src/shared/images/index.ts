import { findCompletedPrivateImageImport as findCompletedImport, importPrivateImage as importImage } from "@core/src/shared/images/application/images";
import { imageRepository } from "@core/src/shared/images/infrastructure/image-repository";
import { createR2ImageStorage } from "@core/src/shared/images/infrastructure/r2-image-storage";
import type { DownloadedImage } from "@core/src/shared/images/application/images";

const storage = createR2ImageStorage({ endpoint: process.env.R2_ENDPOINT ?? "", bucket: process.env.R2_BUCKET ?? "", privateBucket: process.env.R2_PRIVATE_BUCKET ?? "", accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "", publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? "" });

export const findCompletedPrivateImageImport = (companyId: string, sourceKey: string) =>
  findCompletedImport(companyId, sourceKey, imageRepository);

export const importPrivateImage = (companyId: string, sourceKey: string, file: DownloadedImage) =>
  importImage(companyId, sourceKey, file, storage, imageRepository);

export type { DownloadedImage } from "@core/src/shared/images/application/images";
