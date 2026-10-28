import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import i18n from "@mobile/i18n";
import { imageUploadLimits } from "@shared/contracts/images";
import { productPhotoLimits } from "@shared/contracts/products";
import {
  addSelection, cancelUpload, counter, failUpload, finishUpload, freePlaces, hasUnsavedPhotos, loadPhotoField, makePrimary, markForRemoval,
  markRejected, photosToSave, photoUploadSettings, primaryKey, retryUpload, saveBlocker, startUpload, undoRemoval, uploadFailure,
  type PhotoField, type PhotoFailure,
} from "@shared/product-photos";
import type { Result } from "@shared/result";
import { fitJpeg } from "@mobile/shared/infrastructure/jpeg-fitting";

export type PhotoAsset = Readonly<{ uri: string; width: number; height: number }>;
export type SavedPhoto = Readonly<{ id: string; url: string }>;
type Upload = (uri: string, options: Readonly<{ signal: AbortSignal }>) => Promise<Result<Readonly<{ id: string; url: string }>, Readonly<{ code: string; message: string; http?: Readonly<{ status: number }> }>>>;
type Prepare = (asset: PhotoAsset) => Promise<Result<string, Readonly<{ message: string }>>>;
type Job = { controller: AbortController; timer: ReturnType<typeof setTimeout> | null; timedOut: boolean };
/** The strip moves accessibility focus (and the form scrolls) to a thumbnail, the add tile or the line under the strip. */
export type PhotoFocus = Readonly<{ target: string; nonce: number; reveal: boolean }>;
export const addTileTarget = "add";
export const lineTarget = "line";

const bounds = { maxSide: imageUploadLimits.maxSide, maxPixels: imageUploadLimits.maxPixels, maxBytes: imageUploadLimits.maxBytes } as const;
const prepareJpeg: Prepare = (asset) => fitJpeg(asset.uri, asset.width, asset.height, bounds);
const announce = (message: string) => { void AccessibilityInfo.announceForAccessibility(message); };

/** Photo field state of a product form: the shared field rules plus the device side (queue of two jobs, abort, timeout, previews, announcements). */
export function usePhotoField({ upload, prepare = prepareJpeg, saved = [], onAction }: { upload: Upload; prepare?: Prepare; saved?: readonly SavedPhoto[]; onAction?: () => void }) {
  const [field, setField] = useState<PhotoField>(() => loadPhotoField(saved));
  const [notice, setNotice] = useState<Readonly<{ selected: number; added: number }> | null>(null);
  const [focus, setFocus] = useState<PhotoFocus | null>(null);
  const fieldRef = useRef(field);
  const assets = useRef(new Map<string, PhotoAsset>());
  const attempts = useRef(new Map<string, number>());
  const jobs = useRef(new Map<string, Job>());
  const sequence = useRef(0);
  const nonce = useRef(0);
  const mounted = useRef(true);
  const uploadRef = useRef(upload);
  const prepareRef = useRef(prepare);
  const actionRef = useRef(onAction);
  const pumpRef = useRef<() => void>(() => {});
  useEffect(() => { uploadRef.current = upload; prepareRef.current = prepare; actionRef.current = onAction; });

  const apply = useCallback((change: (current: PhotoField) => PhotoField) => {
    const next = change(fieldRef.current);
    fieldRef.current = next;
    if (mounted.current) setField(next);
    return next;
  }, []);
  const focusOn = useCallback((target: string, reveal = false) => { nonce.current += 1; setFocus({ target, nonce: nonce.current, reveal }); }, []);

  const stop = useCallback((key: string) => {
    const job = jobs.current.get(key);
    if (!job) return;
    jobs.current.delete(key);
    if (job.timer) clearTimeout(job.timer);
    job.controller.abort();
  }, []);

  const fail = useCallback((key: string, reason: Readonly<{ failure: PhotoFailure; retryable: boolean }>) => { apply((current) => failUpload(current, key, reason)); }, [apply]);

  const run = useCallback(async (key: string) => {
    const job: Job = { controller: new AbortController(), timer: null, timedOut: false };
    jobs.current.set(key, job);
    const asset = assets.current.get(key);
    const attempt = attempts.current.get(key) ?? 0;
    attempts.current.set(key, attempt + 1);
    apply((current) => startUpload(current, key, Date.now(), asset?.uri ?? null));
    try {
      if (!asset) { fail(key, { failure: "file_gone", retryable: false }); return; }
      let uri: string;
      try {
        const prepared = await prepareRef.current(asset);
        if (jobs.current.get(key) !== job) return;
        if (!prepared.success) { fail(key, { failure: "prepare", retryable: false }); return; }
        uri = prepared.data;
      } catch {
        if (jobs.current.get(key) === job) fail(key, { failure: attempt > 0 ? "file_gone" : "prepare", retryable: false });
        return;
      }
      job.timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, photoUploadSettings.timeoutMs);
      const result = await uploadRef.current(uri, { signal: job.controller.signal });
      // A cancelled or replaced job ignores its late answer.
      if (jobs.current.get(key) !== job) return;
      if (result.success) apply((current) => finishUpload(current, key, { imageId: result.data.id, url: result.data.url }));
      else if (result.error.code === "ABORTED" && !job.timedOut) return;
      else fail(key, job.timedOut ? { failure: "connection", retryable: true } : uploadFailure({ code: result.error.code, ...(result.error.http ? { status: result.error.http.status } : {}) }));
    } finally {
      if (job.timer) clearTimeout(job.timer);
      if (jobs.current.get(key) === job) jobs.current.delete(key);
      pumpRef.current();
    }
  }, [apply, fail]);

  const pump = useCallback(() => {
    if (!mounted.current) return;
    for (const photo of fieldRef.current.photos) {
      if (jobs.current.size >= photoUploadSettings.concurrency) return;
      if (photo.kind === "uploading" && photo.startedAt === null && !jobs.current.has(photo.key)) void run(photo.key);
    }
  }, [run]);

  useEffect(() => { pumpRef.current = pump; });

  useEffect(() => {
    mounted.current = true;
    const running = jobs.current;
    return () => { mounted.current = false; for (const key of [...running.keys()]) stop(key); };
  }, [stop]);

  const reset = useCallback((next: readonly SavedPhoto[]) => {
    for (const key of [...jobs.current.keys()]) stop(key);
    assets.current.clear();
    attempts.current.clear();
    const loaded = loadPhotoField(next);
    fieldRef.current = loaded;
    setField(loaded);
    setNotice(null);
    setFocus(null);
  }, [stop]);

  const add = useCallback((picked: readonly PhotoAsset[]) => {
    actionRef.current?.();
    const keys = picked.map((asset) => { sequence.current += 1; const key = `upload-${sequence.current}`; assets.current.set(key, asset); return key; });
    const before = fieldRef.current;
    const selection = addSelection(before, keys);
    fieldRef.current = selection.field;
    setField(selection.field);
    for (const key of keys.slice(selection.added)) assets.current.delete(key);
    setNotice(selection.skipped > 0 ? { selected: keys.length, added: selection.added } : null);
    if (selection.added > 0) announce(i18n.t("photosAdded", { count: selection.added }));
    if (freePlaces(selection.field) === 0 && selection.added > 0) focusOn(lineTarget);
    pump();
    return selection;
  }, [focusOn, pump]);

  const positionOf = (key: string) => fieldRef.current.photos.findIndex((photo) => photo.key === key) + 1;

  const makePrimaryPhoto = useCallback((key: string) => {
    setNotice(null);
    actionRef.current?.();
    const next = apply((current) => makePrimary(current, key));
    announce(i18n.t("photoNowPrimary", { total: next.photos.length }));
    focusOn(key);
  }, [apply, focusOn]);

  const markPhoto = useCallback((key: string) => {
    setNotice(null);
    actionRef.current?.();
    const before = fieldRef.current;
    const wasPrimary = primaryKey(before) === key;
    const photo = before.photos.find((candidate) => candidate.key === key);
    const next = apply((current) => markForRemoval(current, key));
    const total = next.photos.length;
    const message = i18n.t(photo?.kind === "saved" ? "photoWillDelete" : "photoWillRemove", { position: positionOf(key), total });
    const nextPrimary = primaryKey(next);
    announce(wasPrimary && nextPrimary ? `${message} ${i18n.t("photoNextPrimary", { position: next.photos.findIndex((candidate) => candidate.key === nextPrimary) + 1 })}` : message);
    focusOn(key);
  }, [apply, focusOn]);

  const undoPhoto = useCallback((key: string) => {
    setNotice(null);
    actionRef.current?.();
    const before = primaryKey(fieldRef.current);
    const next = apply((current) => undoRemoval(current, key));
    const message = i18n.t("photoKept", { position: positionOf(key), total: next.photos.length });
    announce(primaryKey(next) === key && before !== key ? `${message} ${i18n.t("photoPrimaryAgain")}` : message);
    focusOn(key);
  }, [apply, focusOn]);

  /** Cancel an upload or drop a failed photo: it leaves the field at once and its place is freed. */
  const dropPhoto = useCallback((key: string) => {
    setNotice(null);
    actionRef.current?.();
    const index = fieldRef.current.photos.findIndex((photo) => photo.key === key);
    stop(key);
    assets.current.delete(key);
    const next = apply((current) => cancelUpload(current, key));
    const left = next.photos.length;
    announce(left === 0 ? i18n.t("photoRemovedNone") : i18n.t("photoRemovedLeft", { count: left }));
    focusOn(next.photos[index]?.key ?? next.photos[index - 1]?.key ?? addTileTarget);
    pump();
  }, [apply, focusOn, pump, stop]);

  const retry = useCallback((key: string) => {
    setNotice(null);
    actionRef.current?.();
    const photo = fieldRef.current.photos.find((candidate) => candidate.key === key);
    if (photo?.kind !== "failed" || !photo.retryable) return;
    apply((current) => retryUpload(current, key));
    focusOn(key);
    pump();
  }, [apply, focusOn, pump]);

  const previewOf = useCallback((key: string) => assets.current.get(key)?.uri ?? null, []);
  const toSave = useCallback(() => photosToSave(fieldRef.current), []);
  const blocker = useCallback(() => saveBlocker(fieldRef.current), []);

  const reject = useCallback((indexes: readonly number[]) => { apply((current) => markRejected(current, indexes)); }, [apply]);

  return {
    field, notice, focus, previewOf, toSave, blocker,
    unsaved: hasUnsavedPhotos(field),
    summary: counter(field), free: freePlaces(field), primary: primaryKey(field),
    max: productPhotoLimits.maxPhotos,
    add, reset, reject, retry, makePrimary: makePrimaryPhoto, mark: markPhoto, undo: undoPhoto, drop: dropPhoto,
    reveal: (key: string) => focusOn(key, true), focusOn, clearNotice: () => setNotice(null),
  };
}

export type PhotoFieldController = ReturnType<typeof usePhotoField>;
