import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, RotateCcw, Star, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import { Field, FieldError, FieldLabel } from "@core/app/components/ui/field";
import { ProductPhotoViewer } from "@core/src/features/products/presentation/product-photo-viewer";
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
// The box always reserves a 2×2 primary plus 8 small cells (4 columns × 3 rows), so its height never depends on how many photos there are.
const smallCells = 8;

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

// Plain buttons, not the design-system Button: its touch rule would grow them to the touch minimum (two of them no longer fit a 4-column tile on a phone); 32 px is the field's approved hit area.
const overlayButton = "inline-flex size-8 items-center justify-center rounded-md bg-background/95 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:bg-background [&_svg]:size-4";

function Thumbnail({ photo, index, total, photos, onOpen }: { photo: FieldPhoto; index: number; total: number; photos: ProductPhotos; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  const local = photos.previews[photo.key];
  const primary = primaryKey(photos.field) === photo.key;
  // The 2×2 cell is always the photo at index 0, whatever its state, so the box keeps its height; «Principal» stays on the primary, which may be a 1×1 tile.
  const big = index === 0;
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
  // A rejected tile is described by its own text, whatever the shared status line shows; a failed tile already carries its reason in its name.
  const reason = rejected ? t("productPhotos.unusablePhoto") : "";
  const action = (name: string, verb: string, icon: ReactNode, run: () => void, extra: Readonly<{ action?: string }> = {}) =>
    <button type="button" className={overlayButton} data-action={extra.action} aria-label={name} title={verb} onClick={run}>{icon}</button>;
  const remove = (run: () => void) => action(t("productPhotos.removeLabel", position), t("productPhotos.removeLabel", position), <Trash2 aria-hidden="true" />, run, { action: "remove" });
  // On a 1×1 tile (about 68 px) the chip drops its icon and wraps only between words, so each word fits whole at text-xs; the 2×2 tile keeps the icon.
  const chip = "absolute inset-x-0.5 bottom-0.5 flex items-center justify-center gap-1 rounded bg-background px-0.5 py-0.5 text-center text-xs leading-tight";

  return <li data-photo={photo.key} className={`group/tile relative aspect-square ${big ? "col-span-2 row-span-2" : ""}`}>
    <div role="group" aria-label={label} aria-describedby={reason ? `photo-reason-${photo.key}` : undefined} className="relative size-full overflow-hidden rounded-md border border-border bg-muted">
      {src && <img src={src} alt="" decoding="async" className={marked || photo.kind === "uploading" || photo.kind === "failed" ? "size-full object-cover opacity-40" : "size-full object-cover"} />}
      {reason && <span id={`photo-reason-${photo.key}`} className="sr-only">{reason}</span>}
      {primary && <span className="absolute left-1 top-1 rounded bg-foreground px-1.5 py-0.5 text-xs font-medium text-background">{t("productPhotos.primary")}</span>}
      {photo.kind === "uploading" && <span className={`${chip} text-foreground`}>{big && <Loader2 aria-hidden="true" className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />}{t("productPhotos.uploading")}</span>}
      {photo.kind === "failed" && <span className={`${chip} text-destructive`}>{big && <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />}{t("productPhotos.failed")}</span>}
      {marked && <span className={`${chip} text-foreground`}>{t(photo.kind === "saved" ? "productPhotos.markSaved" : "productPhotos.markNew")}</span>}
    </div>
    <div className="absolute right-0.5 top-0.5 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100">
      {photo.kind === "uploading" && action(t("productPhotos.cancelUploadLabel", position), t("productPhotos.cancelUpload"), <X aria-hidden="true" />, () => photos.discard(photo.key))}
      {photo.kind === "failed" && photo.retryable && action(t("productPhotos.retryLabel", position), t("productPhotos.retry"), <RotateCcw aria-hidden="true" />, () => photos.retry(photo.key))}
      {photo.kind === "failed" && remove(() => photos.discard(photo.key))}
      {isKept(photo) && marked && action(t("productPhotos.undoLabel", position), t("productPhotos.undo"), <Undo2 aria-hidden="true" />, () => photos.undo(photo.key), { action: "undo" })}
      {isKept(photo) && !marked && !primary && action(t("productPhotos.makePrimaryLabel", position), t("productPhotos.makePrimary"), <Star aria-hidden="true" />, () => photos.promote(photo.key))}
      {isKept(photo) && !marked && remove(() => photos.remove(photo.key))}
    </div>
    {/* After the actions in the DOM so the tile's first button stays the first action; a photo still uploading or failed has nothing to show, so it has no button. */}
    {isKept(photo) && <button type="button" data-photo-open aria-label={t("productPhotos.openLabel", position)} onClick={() => onOpen(photo.key)}
      className="absolute inset-0 rounded-md transition-colors hover:bg-foreground/10 hover:ring-2 hover:ring-inset hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background" />}
  </li>;
}

type StatusText = Readonly<{
  name: (position: number, total: number) => string; failure: (failure: PhotoFailure) => string; unusable: string;
  count: (count: number) => string; countFull: (count: number) => string; marks: (marked: number, saved: boolean) => string; freeUp: string;
}>;
type Status = Readonly<{ kind: "message" | "notice" | "photos" | "counter" | "none"; text: ReactNode }>;

/** The single line under the box: validation message, selection notice, failed or rejected photos, or the counter, in that order. */
function photoStatus(photos: Pick<ProductPhotos, "field" | "notice" | "previews">, message: string | undefined, text: StatusText): Status {
  if (message) return { kind: "message", text: message };
  if (photos.notice) return { kind: "notice", text: photos.notice };
  const { field, previews } = photos;
  const total = field.photos.length;
  const problems = field.photos.flatMap((photo, index) => {
    const name = text.name(index + 1, total);
    if (photo.kind === "failed") {
      const fileName = previews[photo.key]?.file.name;
      return [`${name}: ${fileName ? `${shortName(fileName)}. ` : ""}${text.failure(photo.failure)}`];
    }
    if (isKept(photo) && photo.rejected && !photo.marked) return [`${name}: ${text.unusable}`];
    return [];
  });
  if (problems.length > 0) return { kind: "photos", text: problems.map((line) => <span key={line} className="block">{line}</span>) };
  if (total === 0) return { kind: "none", text: "" };
  const { count, marked, markedSaved } = counter(field);
  const marks = marked > 0 ? text.marks(marked, markedSaved) : "";
  if (freePlaces(field) > 0) return { kind: "counter", text: text.count(count) + marks };
  return { kind: "counter", text: marked > 0 ? text.count(count) + marks + text.freeUp : text.countFull(count) };
}

export function ProductPhotosField({ photos, error }: { photos: ProductPhotos; error?: string }) {
  const { t } = useTranslation();
  const { field } = photos;
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const { focus } = photos;
  useEffect(() => {
    if (!focus || !root.current) return;
    const target = focus.kind === "limit" ? root.current.querySelector("[data-photos-limit]")
      : focus.kind === "message" ? root.current.querySelector("[data-photos-message]")
      : focus.kind === "add" ? root.current.querySelector("[data-photos-add]")
      : root.current.querySelector(focus.action === "first" ? `[data-photo="${focus.key}"] button` : `[data-photo="${focus.key}"] [data-action="${focus.action}"]`);
    if (target instanceof HTMLElement) target.focus();
  }, [focus]);
  const full = freePlaces(field) === 0;
  const blocker = saveBlocker(field);
  const blockText = photos.blocked && blocker?.kind === photos.blocked ? t(photos.blocked === "uploading" ? "productPhotos.waitUploads" : "productPhotos.retryFailed") : "";
  const message = blockText || error;
  const status = photoStatus(photos, message, {
    name: (position, total) => t("productPhotos.name", { position, total }),
    failure: (failure) => failureText((key) => t(key), failure),
    unusable: t("productPhotos.unusablePhoto"),
    count: (count) => t("productPhotos.count", { count }),
    countFull: (count) => t("productPhotos.countFull", { count }),
    marks: (marked, savedOnes) => t(savedOnes ? "productPhotos.markedSaved" : "productPhotos.markedNew", { count: marked }),
    freeUp: t("productPhotos.freeUp"),
  });
  const viewable = field.photos.flatMap((photo, at) => isKept(photo) ? [{ key: photo.key, url: photo.url, position: at + 1, total: field.photos.length }] : []);
  const empty = field.photos.length === 0;
  const open = () => input.current?.click();
  // Free cells keep the box at 12 cells: the 8 small ones minus those taken by the photos next to the primary and by the add tile.
  const smallPhotos = Math.max(0, field.photos.length - 1);
  const addCells = empty || full ? 0 : 1;
  const rest = Math.max(0, smallCells - smallPhotos - addCells);
  const statusClass = "-mx-1 rounded-sm px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const addTile = "flex size-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/50 bg-background p-1 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

  return <Field data-invalid={Boolean(message)}>
    <div ref={root} data-photos-field role="group" aria-labelledby="photos-label" className="grid gap-3">
      <FieldLabel id="photos-label">{t("productPhotos.label")}</FieldLabel>
      <input ref={input} id="photos" name="photos" type="file" multiple accept={accepted} tabIndex={-1} aria-hidden="true" className="sr-only"
        onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length > 0) photos.select(files); }} />
      <ul aria-label={t("productPhotos.list")} className="grid grid-cols-4 gap-1">
        {empty && <li className="col-span-2 row-span-2 aspect-square">
          <button type="button" data-photos-add aria-label={t("productPhotos.add")} aria-describedby="photos-hint" className={addTile} onClick={open}>
            <Plus aria-hidden="true" className="size-5" /><span className="text-sm text-foreground">{t("productPhotos.add")}</span><span id="photos-hint" className="font-normal">{t("productPhotos.hint")}</span>
          </button>
        </li>}
        {field.photos.map((photo, index) => <Thumbnail key={photo.key} photo={photo} index={index} total={field.photos.length} photos={photos} onOpen={setViewing} />)}
        {!empty && !full && <li className="aspect-square">
          <button type="button" data-photos-add aria-describedby="photos-status" className={addTile} onClick={open}><Plus aria-hidden="true" className="size-5" />{t("productPhotos.add")}</button>
        </li>}
        {Array.from({ length: rest }, (_, at) => <li key={`free-${at}`} aria-hidden="true" className="aspect-square" />)}
      </ul>
      {status.kind !== "none" && (status.kind === "message"
        ? <FieldError id="photos-status" data-photos-message {...(full ? { "data-photos-limit": "" } : {})} tabIndex={-1} className={`${statusClass} text-destructive`}>{status.text}</FieldError>
        : <p id="photos-status" tabIndex={full ? -1 : undefined} {...(full ? { "data-photos-limit": "" } : {})} {...(status.kind === "notice" ? { "data-photo-notice": "" } : {})}
            className={`${statusClass} ${status.kind === "photos" ? "text-destructive" : "text-muted-foreground"}`}>{status.text}</p>)}
      {viewing !== null && <ProductPhotoViewer photos={viewable} current={viewing} onChange={setViewing} onClose={() => setViewing(null)}
        onCloseAutoFocus={(event) => { event.preventDefault(); root.current?.querySelector<HTMLElement>(`[data-photo="${viewing}"] [data-photo-open]`)?.focus(); }} />}
      <p aria-live="polite" aria-atomic="true" data-photo-live className="sr-only"><span key={photos.announcement.id}>{photos.announcement.text}</span></p>
    </div>
  </Field>;
}
