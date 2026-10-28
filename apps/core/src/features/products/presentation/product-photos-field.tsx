import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@core/app/components/ui/button";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { uploadImageFile } from "@core/src/shared/images/presentation/client";
import { imageUploadLimits } from "@shared/contracts/images";
import {
  addSelection, cancelUpload, counter, failUpload, finishUpload, freePlaces, loadPhotoField, makePrimary, markForRemoval, markRejected, photosToSave, photoUploadSettings,
  primaryKey, retryUpload, saveBlocker, startUpload, undoRemoval, uploadFailure, hasUnsavedPhotos,
  type FieldPhoto, type PhotoField, type PhotoFailure, type PhotosToSave,
} from "@shared/product-photos";

export type SavedPhoto = Readonly<{ id: string; url: string }>;

type Focus =
  | Readonly<{ kind: "action"; key: string; action: "remove" | "undo" | "first" }>
  | Readonly<{ kind: "add" }>
  | Readonly<{ kind: "limit" }>
  | Readonly<{ kind: "message" }>;
type Local = Readonly<{ file: File; previewUrl: string | null }>;
type Attempt = Readonly<{ controller: AbortController; timer: ReturnType<typeof setTimeout> }>;
type Blocked = "uploading" | "failed" | null;

type Translate = (key: (typeof failureKeys)[PhotoFailure]) => string;
const failureKeys = {
  weight: "productPhotos.weight", dimensions: "productPhotos.dimensions", format: "productPhotos.format",
  prepare: "productPhotos.prepare", connection: "productPhotos.connection", file_gone: "productPhotos.fileGone",
} as const;
const failureText = (translate: Translate, failure: PhotoFailure): string => translate(failureKeys[failure]);

const accepted = "image/jpeg,image/png,image/webp";
const isKept = (photo: FieldPhoto): photo is Extract<FieldPhoto, { kind: "saved" | "uploaded" }> => photo.kind === "saved" || photo.kind === "uploaded";
const isMarked = (photo: FieldPhoto) => isKept(photo) && photo.marked;
const keptKeys = (field: PhotoField): string[] => field.photos.filter((photo) => isKept(photo) && !photo.marked).map((photo) => photo.key);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const shortName = (name: string) => name.length > 20 ? `${name.slice(0, 11)}…${name.slice(-8)}` : name;

/** State, upload queue and focus rules of the «Fotos» field; the pure rules live in `shared/product-photos`. */
export function useProductPhotos(saved: readonly SavedPhoto[]) {
  const { t } = useTranslation();
  const [initial] = useState(() => loadPhotoField(saved));
  const [field, setField] = useState<PhotoField>(initial);
  const fieldRef = useRef<PhotoField>(initial);
  const locals = useRef(new Map<string, Local>());
  const attempts = useRef(new Map<string, Attempt>());
  const sequence = useRef(0);
  const [previews, setPreviews] = useState<Readonly<Record<string, Local>>>({});
  const [notice, setNotice] = useState("");
  // Each announcement is a new value, so the same text twice in a row reaches the screen reader twice.
  const [announcement, setAnnouncement] = useState<Readonly<{ text: string; id: number }>>({ text: "", id: 0 });
  const sent = useRef<readonly string[]>([]);
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  // The translator changes identity with the language; the queue reads the latest one.
  const translate = useRef(t);
  translate.current = t;

  const announce = useCallback((text: string) => setAnnouncement((current) => ({ text, id: current.id + 1 })), []);
  const commit = useCallback((next: PhotoField) => { fieldRef.current = next; setField(next); }, []);
  const positionOf = (key: string, from: PhotoField = fieldRef.current) => from.photos.findIndex((photo) => photo.key === key) + 1;
  // The announcement reads «no se subió: pesa más de 10 MB.»: lowercase, and the template adds the final period.
  const reasonText = (failure: PhotoFailure) => lowerFirst(failureText((key) => translate.current(key), failure)).replace(/\.$/, "");

  // An upload that settles removes the buttons of its thumbnail; focus that was on them moves to the thumbnail's first action instead of falling to the page.
  const holdsFocus = (key: string) => typeof document !== "undefined" && Boolean(document.activeElement?.closest(`[data-photo="${key}"]`));
  const keepFocus = (key: string) => { if (holdsFocus(key)) setFocus({ kind: "action", key, action: "first" }); };

  const release = useCallback((key: string) => {
    const attempt = attempts.current.get(key);
    if (attempt) { clearTimeout(attempt.timer); attempt.controller.abort(); attempts.current.delete(key); }
    const local = locals.current.get(key);
    if (local?.previewUrl) URL.revokeObjectURL(local.previewUrl);
    locals.current.delete(key);
    setPreviews((current) => Object.fromEntries(Object.entries(current).filter(([other]) => other !== key)));
  }, []);

  const settle = useCallback((key: string, attempt: Attempt, outcome: Readonly<{ imageId: string; url: string }> | Readonly<{ code: string; status?: number }>) => {
    if (attempts.current.get(key) !== attempt) return;
    clearTimeout(attempt.timer);
    attempts.current.delete(key);
    keepFocus(key);
    if ("imageId" in outcome) commit(finishUpload(fieldRef.current, key, outcome));
    else {
      const reason = uploadFailure(outcome);
      commit(failUpload(fieldRef.current, key, reason));
      announce(translate.current("productPhotos.uploadFailed", { position: positionOf(key), reason: reasonText(reason.failure) }));
    }
    pump();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pump() {
    for (;;) {
      const current = fieldRef.current;
      const running = current.photos.filter((photo) => photo.kind === "uploading" && photo.startedAt !== null).length;
      const next = current.photos.find((photo) => photo.kind === "uploading" && photo.startedAt === null && locals.current.has(photo.key));
      if (!next || running >= photoUploadSettings.concurrency) return;
      begin(next.key);
    }
  }

  function begin(key: string) {
    const local = locals.current.get(key)!;
    commit(startUpload(fieldRef.current, key, Date.now(), local.previewUrl));
    const controller = new AbortController();
    const attempt: Attempt = {
      controller,
      timer: setTimeout(() => {
        if (attempts.current.get(key) !== attempt) return;
        attempts.current.delete(key);
        keepFocus(key);
        controller.abort();
        const reason = { failure: "connection", retryable: true } as const;
        commit(failUpload(fieldRef.current, key, reason));
        announce(translate.current("productPhotos.uploadFailed", { position: positionOf(key), reason: reasonText("connection") }));
        pump();
      }, photoUploadSettings.timeoutMs),
    };
    attempts.current.set(key, attempt);
    void uploadImageFile(local.file, { signal: controller.signal }).then((result) =>
      settle(key, attempt, result.success ? { imageId: result.data.id, url: result.data.url } : result.error));
  }

  useEffect(() => () => { for (const key of [...locals.current.keys()]) release(key); }, [release]);

  function select(files: readonly File[]) {
    const before = fieldRef.current;
    const keys = files.map(() => `photo-${(sequence.current += 1)}`);
    const result = addSelection(before, keys);
    if (result.added === 0) return;
    let next = result.field;
    const heavy: string[] = [];
    keys.slice(0, result.added).forEach((key, index) => {
      const file = files[index]!;
      locals.current.set(key, { file, previewUrl: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null });
      if (file.size > imageUploadLimits.maxBytes) { next = failUpload(next, key, { failure: "weight", retryable: false }); heavy.push(key); }
    });
    const weightFailures = heavy.map((key) => t("productPhotos.uploadFailed", { position: positionOf(key, next), reason: reasonText("weight") }));
    commit(next);
    setPreviews((current) => ({ ...current, ...Object.fromEntries(keys.slice(0, result.added).map((key) => [key, locals.current.get(key)!])) }));
    const free = freePlaces(before);
    const text = result.skipped === 0 ? "" : free === 1
      ? t("productPhotos.noticeOne", { chosen: files.length }) : t("productPhotos.noticeMany", { chosen: files.length, places: free });
    setNotice(text);
    const full = freePlaces(next) === 0;
    const limit = full ? t(counter(next).marked > 0 ? "productPhotos.limitMarked" : "productPhotos.limit") : "";
    announce([text || t("productPhotos.added", { count: result.added }), ...weightFailures, limit].filter(Boolean).join(" "));
    if (full) setFocus({ kind: "limit" });
    pump();
  }

  function promote(key: string) {
    const before = fieldRef.current;
    commit(makePrimary(before, key));
    announce(t("productPhotos.madePrimary", { total: before.photos.length }));
    setFocus({ kind: "action", key, action: "remove" });
  }

  function remove(key: string) {
    const before = fieldRef.current;
    const next = markForRemoval(before, key);
    const photo = before.photos.find((candidate) => candidate.key === key);
    const wasPrimary = primaryKey(before) === key;
    const promoted = wasPrimary ? primaryKey(next) : null;
    commit(next);
    const mark = photo?.kind === "saved" ? "productPhotos.announceSaved" : "productPhotos.announceNew";
    announce(t(mark, { position: positionOf(key, before), total: before.photos.length }) + (promoted ? t("productPhotos.promoted", { position: positionOf(promoted, next) }) : ""));
    setFocus({ kind: "action", key, action: "undo" });
  }

  function undo(key: string) {
    const before = fieldRef.current;
    const next = undoRemoval(before, key);
    commit(next);
    const again = primaryKey(next) === key && primaryKey(before) !== key;
    announce(t("productPhotos.kept", { position: positionOf(key, before), total: before.photos.length }) + (again ? t("productPhotos.primaryAgain") : ""));
    setFocus({ kind: "action", key, action: "remove" });
  }

  /** Drops an uploading or failed photo: it was never part of the product, so it leaves without a mark. */
  function discard(key: string) {
    const before = fieldRef.current;
    const index = before.photos.findIndex((photo) => photo.key === key);
    const neighbour = before.photos[index + 1] ?? before.photos[index - 1];
    release(key);
    const next = cancelUpload(before, key);
    commit(next);
    const left = next.photos.length;
    announce(left === 0 ? t("productPhotos.removedNone") : t("productPhotos.removed", { count: left }));
    setFocus(neighbour ? { kind: "action", key: neighbour.key, action: "first" } : { kind: "add" });
    pump();
  }

  function retry(key: string) {
    const photo = fieldRef.current.photos.find((candidate) => candidate.key === key);
    if (photo?.kind !== "failed" || !photo.retryable) return;
    commit(retryUpload(fieldRef.current, key));
    // The retried button unmounts; focus stays on the same thumbnail, on its Cancelar subida.
    setFocus({ kind: "action", key, action: "first" });
    pump();
  }

  /** Maps the rejected indexes of a save to thumbnails; false when none could be identified. */
  function reject(indexes: readonly number[]): boolean {
    // The indexes point into the list the save sent; the field may have changed since, so they are mapped through the sent keys.
    const current = keptKeys(fieldRef.current);
    const mapped = indexes.flatMap((index) => { const at = sent.current[index] === undefined ? -1 : current.indexOf(sent.current[index]); return at < 0 ? [] : [at]; });
    const next = markRejected(fieldRef.current, mapped);
    commit(next);
    const hit = next.photos.find((photo) => isKept(photo) && photo.rejected);
    if (hit) setFocus({ kind: "action", key: hit.key, action: "first" });
    return Boolean(hit);
  }

  /** Clears earlier rejections and the selection notice; returns what to send, or null (with the reason shown) while a photo is uploading or failed. */
  function prepareSave(): PhotosToSave | null {
    commit(markRejected(fieldRef.current, []));
    setNotice("");
    sent.current = keptKeys(fieldRef.current);
    const blocker = saveBlocker(fieldRef.current);
    setBlocked(blocker?.kind ?? null);
    if (!blocker) return photosToSave(fieldRef.current);
    setFocus({ kind: "action", key: blocker.key, action: "first" });
    return null;
  }

  function focusMessage() { setFocus({ kind: "message" }); }

  return {
    field, notice, announcement, blocked, focus, previews,
    dirty: hasUnsavedPhotos(field),
    select, promote, remove, undo, discard, retry, reject, prepareSave, focusMessage,
  };
}

export type ProductPhotos = ReturnType<typeof useProductPhotos>;

function Thumbnail({ photo, index, total, photos }: { photo: FieldPhoto; index: number; total: number; photos: ProductPhotos }) {
  const { t } = useTranslation();
  const local = photos.previews[photo.key];
  const primary = primaryKey(photos.field) === photo.key;
  const position = { position: index + 1, total };
  const marked = isMarked(photo);
  const src = isKept(photo) ? photo.url : local?.previewUrl ?? photo.previewUrl;
  const failure = photo.kind === "failed" ? failureText((key) => t(key), photo.failure) : "";
  const state = photo.kind === "uploading" ? t("productPhotos.nameState.uploading")
    : photo.kind === "failed" ? t("productPhotos.nameState.failed", { reason: lowerFirst(failure).replace(/\.$/, "") })
    : marked ? t(photo.kind === "saved" ? "productPhotos.nameState.markSaved" : "productPhotos.nameState.markNew") : "";
  const fileName = photo.kind === "failed" ? local?.file.name : undefined;
  const label = [t("productPhotos.name", position), primary ? t("productPhotos.nameState.primary") : "", fileName, state].filter(Boolean).join(", ");
  const rejected = isKept(photo) && photo.rejected && !photo.marked;
  const text = "inline-flex h-8 items-center px-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const remove = (action: () => void) => <Button type="button" variant="ghost" size="icon" data-action="remove" aria-label={t("productPhotos.removeLabel", position)} title={t("productPhotos.removeLabel", position)} onClick={action}><Trash2 aria-hidden="true" /></Button>;

  return <li data-photo={photo.key} className="grid w-28 content-start gap-1">
    <div role="group" aria-label={label} className="relative size-28 overflow-hidden rounded-md border border-border bg-muted">
      {src && <img src={src} alt="" decoding="async" className={marked || photo.kind === "uploading" || photo.kind === "failed" ? "size-full object-cover opacity-40" : "size-full object-cover"} />}
      {primary && <span className="absolute left-1 top-1 rounded bg-foreground px-1.5 py-0.5 text-xs font-medium text-background">{t("productPhotos.primary")}</span>}
      {photo.kind === "uploading" && <span className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded bg-background px-1.5 py-0.5 text-xs text-foreground"><Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />{t("productPhotos.uploading")}</span>}
      {photo.kind === "failed" && <span className="absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 rounded bg-background px-1.5 py-0.5 text-xs text-destructive"><TriangleAlert aria-hidden="true" className="size-3" />{t("productPhotos.failed")}</span>}
      {marked && <span className="absolute inset-x-1 bottom-1 rounded bg-background px-1.5 py-0.5 text-center text-xs text-foreground">{t(photo.kind === "saved" ? "productPhotos.markSaved" : "productPhotos.markNew")}</span>}
    </div>
    {photo.kind === "failed" && <div className="grid gap-0.5 text-xs">
      {fileName && <span title={fileName} className="text-foreground">{shortName(fileName)}</span>}
      <span className="text-destructive">{failure}</span>
    </div>}
    {rejected && <p className="text-xs text-destructive">{t("productPhotos.unusablePhoto")}</p>}
    <div className="flex min-h-8 flex-wrap items-center gap-x-1">
      {photo.kind === "uploading" && <button type="button" className={text} aria-label={t("productPhotos.cancelUploadLabel", position)} onClick={() => photos.discard(photo.key)}>{t("productPhotos.cancelUpload")}</button>}
      {photo.kind === "failed" && photo.retryable && <button type="button" className={text} aria-label={t("productPhotos.retryLabel", position)} onClick={() => photos.retry(photo.key)}>{t("productPhotos.retry")}</button>}
      {photo.kind === "failed" && remove(() => photos.discard(photo.key))}
      {isKept(photo) && marked && <button type="button" data-action="undo" className={text} aria-label={t("productPhotos.undoLabel", position)} onClick={() => photos.undo(photo.key)}>{t("productPhotos.undo")}</button>}
      {isKept(photo) && !marked && !primary && <button type="button" className={text} aria-label={t("productPhotos.makePrimaryLabel", position)} onClick={() => photos.promote(photo.key)}>{t("productPhotos.makePrimary")}</button>}
      {isKept(photo) && !marked && remove(() => photos.remove(photo.key))}
    </div>
  </li>;
}

export function ProductPhotosField({ photos, error }: { photos: ProductPhotos; error?: string }) {
  const { t } = useTranslation();
  const { field } = photos;
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const { focus } = photos;
  useEffect(() => {
    if (!focus || !root.current) return;
    const target = focus.kind === "limit" ? root.current.querySelector("[data-photos-limit]")
      : focus.kind === "message" ? root.current.querySelector("[data-photos-message]")
      : focus.kind === "add" ? root.current.querySelector("[data-photos-add]")
      : root.current.querySelector(focus.action === "first" ? `[data-photo="${focus.key}"] button` : `[data-photo="${focus.key}"] [data-action="${focus.action}"]`);
    if (target instanceof HTMLElement) target.focus();
  }, [focus]);
  const { count, marked, markedSaved } = counter(field);
  const full = freePlaces(field) === 0;
  const blocker = saveBlocker(field);
  const blockText = photos.blocked && blocker?.kind === photos.blocked ? t(photos.blocked === "uploading" ? "productPhotos.waitUploads" : "productPhotos.retryFailed") : "";
  const message = blockText || error;
  const summary = count === 0 ? t("productPhotos.hint")
    : t("productPhotos.count", { count }) + (marked > 0 ? t(markedSaved ? "productPhotos.markedSaved" : "productPhotos.markedNew", { count: marked }) : "");

  return <Field data-invalid={Boolean(message)}>
    <div ref={root} data-photos-field role="group" aria-labelledby="photos-label" className="grid gap-3">
      <FieldLabel id="photos-label">{t("productPhotos.label")}</FieldLabel>
      <input ref={input} id="photos" name="photos" type="file" multiple accept={accepted} tabIndex={-1} aria-hidden="true" className="sr-only"
        onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length > 0) photos.select(files); }} />
      {field.photos.length > 0 && <ul aria-label={t("productPhotos.list")} className="flex flex-wrap gap-4">
        {field.photos.map((photo, index) => <Thumbnail key={photo.key} photo={photo} index={index} total={field.photos.length} photos={photos} />)}
      </ul>}
      <div className="flex flex-wrap items-center gap-3">
        {full
          ? <p data-photos-limit tabIndex={-1} className="text-sm text-muted-foreground outline-none">{t(marked > 0 ? "productPhotos.limitMarked" : "productPhotos.limit")}</p>
          : <Button type="button" variant="outline" data-photos-add aria-describedby="photos-summary" onClick={() => input.current?.click()}>{t("productPhotos.add")}</Button>}
        <p id="photos-summary" className="text-sm text-muted-foreground">{summary}</p>
      </div>
      {photos.notice && <p data-photo-notice className="text-sm text-muted-foreground">{photos.notice}</p>}
      {message && <FieldError id="photos-error" data-photos-message tabIndex={-1} className="text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring">{message}</FieldError>}
      <p aria-live="polite" aria-atomic="true" data-photo-live className="sr-only"><span key={photos.announcement.id}>{photos.announcement.text}</span></p>
    </div>
  </Field>;
}
