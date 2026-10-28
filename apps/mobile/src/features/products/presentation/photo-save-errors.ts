import i18n from "@mobile/i18n";
import { productPhotoLimits } from "@shared/contracts/products";
import type { PhotoFieldController } from "./use-photo-field";

type SaveError = Readonly<{ code?: string; issues?: readonly Readonly<{ scope?: string; reason: string; index?: number }>[] }>;
const photoIssues = (error: SaveError) => (error.issues ?? []).filter((issue) => issue.scope === "photo");

/** Why Guardar sends nothing while photos are uploading or failed; the strip shows and focuses the first such thumbnail. */
export function photoSaveBlocker(photos: PhotoFieldController): string | null {
  const blocker = photos.blocker();
  if (!blocker) return null;
  photos.reveal(blocker.key);
  return i18n.t(blocker.kind === "uploading" ? "saveWhileUploading" : "saveWithFailedPhotos");
}

/** Indexes into the sent photo list that core could not use. */
export function rejectedPhotoIndexes(error: SaveError): number[] {
  return photoIssues(error).flatMap((issue) => issue.index !== undefined && (issue.reason === "PHOTO_NOT_FOUND" || issue.reason === "DUPLICATE_PHOTO") ? [issue.index] : []);
}

/** The form-level text of a photo rejection that no thumbnail can carry. */
export function photoFormError(error: SaveError, rejected: readonly number[]): string | null {
  if ((error.issues ?? []).some((issue) => issue.reason === "TOO_MANY_PHOTOS")) return i18n.t("photosTooMany", { max: productPhotoLimits.maxPhotos });
  const unlocated = photoIssues(error).some((issue) => (issue.reason === "PHOTO_NOT_FOUND" || issue.reason === "DUPLICATE_PHOTO") && issue.index === undefined);
  return unlocated || (error.code === "IMAGE_NOT_FOUND" && rejected.length === 0) ? i18n.t("photoRejectedField") : null;
}
