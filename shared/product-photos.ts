import { productPhotoLimits } from "@shared/contracts/products";

type ImageId = string;

/** What a product save sends for photos: nothing when the list is the loaded one, otherwise the whole ordered list of image ids. */
export type PhotosToSave = Readonly<{ kind: "untouched" }> | Readonly<{ kind: "set"; photoIds: readonly string[] }>;

export const photoUploadSettings = { concurrency: 2, timeoutMs: 120_000 } as const;

export type PhotoFailure = "weight" | "dimensions" | "format" | "prepare" | "connection" | "file_gone";

export type FieldPhoto =
  | Readonly<{ key: string; kind: "saved"; imageId: ImageId; url: string; marked: boolean; rejected: boolean }>
  | Readonly<{ key: string; kind: "uploading"; previewUrl: string | null; startedAt: number | null }>
  | Readonly<{ key: string; kind: "uploaded"; imageId: ImageId; url: string; marked: boolean; rejected: boolean }>
  | Readonly<{ key: string; kind: "failed"; previewUrl: string | null; failure: PhotoFailure; retryable: boolean }>;

export type PhotoField = Readonly<{ loaded: readonly ImageId[]; photos: readonly FieldPhoto[] }>;

type KeptPhoto = Extract<FieldPhoto, { kind: "saved" | "uploaded" }>;

export function loadPhotoField(saved: readonly Readonly<{ id: ImageId; url: string }>[]): PhotoField {
  return {
    loaded: saved.map((photo) => photo.id),
    photos: saved.map((photo) => ({ key: photo.id, kind: "saved", imageId: photo.id, url: photo.url, marked: false, rejected: false })),
  };
}

export function freePlaces(field: PhotoField): number {
  return Math.max(0, productPhotoLimits.maxPhotos - field.photos.length);
}

/** Adds queued uploads for the first keys that fit in the free places; `skipped` counts the rest. */
export function addSelection(field: PhotoField, keys: readonly string[]): Readonly<{ field: PhotoField; added: number; skipped: number }> {
  const accepted = keys.slice(0, freePlaces(field));
  const photos: FieldPhoto[] = accepted.map((key) => ({ key, kind: "uploading", previewUrl: null, startedAt: null }));
  return { field: { ...field, photos: [...field.photos, ...photos] }, added: accepted.length, skipped: keys.length - accepted.length };
}

function mapPhoto(field: PhotoField, key: string, change: (photo: FieldPhoto) => FieldPhoto): PhotoField {
  return { ...field, photos: field.photos.map((photo) => (photo.key === key ? change(photo) : photo)) };
}

export function startUpload(field: PhotoField, key: string, startedAt: number, previewUrl?: string | null): PhotoField {
  return mapPhoto(field, key, (photo) => (photo.kind === "uploading" ? { ...photo, startedAt, previewUrl: previewUrl ?? photo.previewUrl } : photo));
}

export function finishUpload(field: PhotoField, key: string, image: Readonly<{ imageId: ImageId; url: string }>): PhotoField {
  return mapPhoto(field, key, (photo) =>
    photo.kind === "uploading" ? { key, kind: "uploaded", imageId: image.imageId, url: image.url, marked: false, rejected: false } : photo);
}

export function failUpload(field: PhotoField, key: string, reason: Readonly<{ failure: PhotoFailure; retryable: boolean }>): PhotoField {
  return mapPhoto(field, key, (photo) => (photo.kind === "uploading" ? { key, kind: "failed", previewUrl: photo.previewUrl, ...reason } : photo));
}

/** Drops an uploading or failed photo from the field, freeing its place. */
export function cancelUpload(field: PhotoField, key: string): PhotoField {
  return { ...field, photos: field.photos.filter((photo) => photo.key !== key || (photo.kind !== "uploading" && photo.kind !== "failed")) };
}

/** A failed photo goes back to the queue in the same place. */
export function retryUpload(field: PhotoField, key: string): PhotoField {
  return mapPhoto(field, key, (photo) => (photo.kind === "failed" ? { key, kind: "uploading", previewUrl: photo.previewUrl, startedAt: null } : photo));
}

function isKept(photo: FieldPhoto): photo is KeptPhoto {
  return photo.kind === "saved" || photo.kind === "uploaded";
}

/** Moves a kept, unmarked photo first; the others keep their relative order. */
export function makePrimary(field: PhotoField, key: string): PhotoField {
  const target = field.photos.find((photo) => photo.key === key);
  if (!target || !isKept(target) || target.marked) return field;
  return { ...field, photos: [target, ...field.photos.filter((photo) => photo.key !== key)] };
}

function setMarked(field: PhotoField, key: string, marked: boolean): PhotoField {
  return mapPhoto(field, key, (photo) => (isKept(photo) ? { ...photo, marked } : photo));
}

export function markForRemoval(field: PhotoField, key: string): PhotoField {
  return setMarked(field, key, true);
}

export function undoRemoval(field: PhotoField, key: string): PhotoField {
  return setMarked(field, key, false);
}

/** The first photo that is not marked, in any state. */
export function primaryKey(field: PhotoField): string | null {
  return field.photos.find((photo) => !isKept(photo) || !photo.marked)?.key ?? null;
}

export function counter(field: PhotoField): Readonly<{ count: number; marked: number; markedSaved: boolean }> {
  const marked = field.photos.filter((photo) => isKept(photo) && photo.marked);
  return { count: field.photos.length, marked: marked.length, markedSaved: marked.some((photo) => photo.kind === "saved") };
}

export function saveBlocker(field: PhotoField): Readonly<{ kind: "uploading" | "failed"; key: string }> | null {
  const uploading = field.photos.find((photo) => photo.kind === "uploading");
  if (uploading) return { kind: "uploading", key: uploading.key };
  const failed = field.photos.find((photo) => photo.kind === "failed");
  return failed ? { kind: "failed", key: failed.key } : null;
}

function keptImageIds(field: PhotoField): ImageId[] {
  return field.photos.filter(isKept).filter((photo) => !photo.marked).map((photo) => photo.imageId);
}

export function photosToSave(field: PhotoField): PhotosToSave {
  const photoIds = keptImageIds(field);
  const untouched = photoIds.length === field.loaded.length && photoIds.every((id, index) => id === field.loaded[index]);
  return untouched ? { kind: "untouched" } : { kind: "set", photoIds };
}

export function hasUnsavedPhotos(field: PhotoField): boolean {
  return photosToSave(field).kind === "set" || field.photos.some((photo) => photo.kind === "uploading" || photo.kind === "failed");
}

/** Marks the photos that produced the rejected indexes of the list sent by the save; clears earlier marks. */
export function markRejected(field: PhotoField, sentIndexes: readonly number[]): PhotoField {
  const sent = field.photos.filter(isKept).filter((photo) => !photo.marked).map((photo) => photo.key);
  const rejected = new Set(sentIndexes.map((index) => sent[index]));
  return { ...field, photos: field.photos.map((photo) => (isKept(photo) ? { ...photo, rejected: rejected.has(photo.key) } : photo)) };
}

export function uploadFailure(error: Readonly<{ code: string; status?: number }>): Readonly<{ failure: PhotoFailure; retryable: boolean }> {
  if (error.code === "IMAGE_TOO_LARGE" || error.status === 413) return { failure: "dimensions", retryable: false };
  if (error.code === "INVALID_IMAGE" || error.code === "UNSUPPORTED_MEDIA_TYPE" || error.status === 415) return { failure: "format", retryable: false };
  return { failure: "connection", retryable: true };
}
