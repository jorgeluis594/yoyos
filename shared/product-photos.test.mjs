import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addSelection, cancelUpload, counter, failUpload, finishUpload, freePlaces, hasUnsavedPhotos, loadPhotoField, makePrimary, markForRemoval,
  markRejected, photosToSave, photoUploadSettings, primaryKey, retryUpload, saveBlocker, startUpload, undoRemoval, uploadFailure,
} from "./product-photos.ts";

const saved = (...ids) => ids.map((id) => ({ id, url: `https://img/${id}` }));
const keys = (field) => field.photos.map((photo) => photo.key);
const upload = (field, key, imageId) => finishUpload(startUpload(field, key, 1), key, { imageId, url: `https://img/${imageId}` });

test("keeps the picker order even when a later photo finishes uploading first", () => {
  let { field } = addSelection(loadPhotoField(saved("A")), ["k1", "k2", "k3"]);
  field = upload(field, "k3", "C");
  field = upload(field, "k2", "B");
  field = upload(field, "k1", "A2");
  assert.deepEqual(keys(field), ["A", "k1", "k2", "k3"]);
  assert.deepEqual(photosToSave(field), { kind: "set", photoIds: ["A", "A2", "B", "C"] });
});

test("makePrimary moves a photo first and keeps the others' relative order", () => {
  const field = makePrimary(loadPhotoField(saved("A", "B", "C", "D")), "C");
  assert.deepEqual(keys(field), ["C", "A", "B", "D"]);
  assert.equal(primaryKey(field), "C");
});

test("makePrimary is not available on uploading, failed or marked photos", () => {
  let { field } = addSelection(loadPhotoField(saved("A", "B")), ["u", "f"]);
  field = failUpload(startUpload(field, "f", 1), "f", { failure: "connection", retryable: true });
  field = markForRemoval(field, "B");
  assert.deepEqual(keys(makePrimary(field, "u")), ["A", "B", "u", "f"]);
  assert.deepEqual(keys(makePrimary(field, "f")), ["A", "B", "u", "f"]);
  assert.deepEqual(keys(makePrimary(field, "B")), ["A", "B", "u", "f"]);
  assert.deepEqual(keys(makePrimary(field, "missing")), ["A", "B", "u", "f"]);
});

test("marking the primary passes primary to the next unmarked photo", () => {
  const field = markForRemoval(loadPhotoField(saved("A", "B", "C")), "A");
  assert.equal(primaryKey(field), "B");
  assert.equal(primaryKey(markForRemoval(field, "B")), "C");
  assert.equal(primaryKey(markForRemoval(markForRemoval(field, "B"), "C")), null);
});

test("undoing a mark on the first photo makes it primary again", () => {
  const field = loadPhotoField(saved("A", "B", "C"));
  assert.equal(primaryKey(undoRemoval(markForRemoval(field, "A"), "A")), "A");
});

test("a photo added in this session is marked to be removed and a saved one to be deleted", () => {
  const { field: added } = addSelection(loadPhotoField(saved("A")), ["k"]);
  const field = markForRemoval(markForRemoval(upload(added, "k", "B"), "k"), "A");
  assert.deepEqual(field.photos.map((photo) => [photo.kind, photo.marked]), [["saved", true], ["uploaded", true]]);
  assert.deepEqual(counter(field), { count: 2, marked: 2, markedSaved: true });
  assert.deepEqual(counter(markForRemoval(upload(added, "k", "B"), "k")), { count: 2, marked: 1, markedSaved: false });
});

test("every photo in the field takes a place until it leaves or the product is saved", () => {
  let { field } = addSelection(loadPhotoField(saved("A", "B")), ["u", "f"]);
  field = failUpload(startUpload(field, "f", 1), "f", { failure: "format", retryable: false });
  assert.equal(freePlaces(field), 4);
  assert.equal(freePlaces(cancelUpload(field, "f")), 5);
  assert.deepEqual(keys(cancelUpload(field, "u")), ["A", "B", "f"]);
  assert.deepEqual(keys(cancelUpload(field, "A")), ["A", "B", "u", "f"]);
});

test("a marked photo frees its place only after the save", () => {
  const field = markForRemoval(loadPhotoField(saved("A", "B", "C", "D", "E", "F", "G")), "G");
  assert.equal(freePlaces(field), 1);
  assert.equal(freePlaces(loadPhotoField(saved("A", "B", "C", "D", "E", "F"))), 2);
});

test("a selection over the free places adds only the first ones and reports the rest", () => {
  const field = loadPhotoField(saved("A", "B", "C", "D", "E", "F"));
  const result = addSelection(field, ["k1", "k2", "k3", "k4"]);
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 2);
  assert.equal(freePlaces(result.field), 0);
  assert.deepEqual(keys(result.field).slice(6), ["k1", "k2"]);
  assert.deepEqual(addSelection(result.field, ["z"]), { field: result.field, added: 0, skipped: 1 });
  assert.equal(photoUploadSettings.concurrency, 2);
});

test("photosToSave is untouched when the actions end at the loaded list", () => {
  const field = loadPhotoField(saved("A", "B", "C"));
  assert.deepEqual(photosToSave(field), { kind: "untouched" });
  assert.deepEqual(photosToSave(makePrimary(makePrimary(field, "B"), "A")), { kind: "untouched" });
  assert.deepEqual(photosToSave(undoRemoval(markForRemoval(field, "B"), "B")), { kind: "untouched" });
  assert.deepEqual(photosToSave(loadPhotoField([])), { kind: "untouched" });
});

test("photosToSave lists kept and uploaded photos in field order without marked ones", () => {
  let { field } = addSelection(loadPhotoField(saved("A", "B", "C")), ["k", "u"]);
  field = upload(field, "k", "D");
  field = markForRemoval(makePrimary(field, "C"), "A");
  assert.deepEqual(photosToSave(field), { kind: "set", photoIds: ["C", "B", "D"] });
  assert.deepEqual(photosToSave(markForRemoval(loadPhotoField(saved("A")), "A")), { kind: "set", photoIds: [] });
});

test("hasUnsavedPhotos is true when the only change is an upload in progress", () => {
  const { field } = addSelection(loadPhotoField(saved("A", "B")), ["k"]);
  assert.deepEqual(photosToSave(field), { kind: "untouched" });
  assert.equal(hasUnsavedPhotos(field), true);
  assert.equal(hasUnsavedPhotos(startUpload(field, "k", 5)), true);
});

test("hasUnsavedPhotos is true when the only change is a failed photo", () => {
  const { field } = addSelection(loadPhotoField(saved("A")), ["k"]);
  const failed = failUpload(startUpload(field, "k", 1), "k", { failure: "weight", retryable: false });
  assert.deepEqual(photosToSave(failed), { kind: "untouched" });
  assert.equal(hasUnsavedPhotos(failed), true);
  assert.equal(hasUnsavedPhotos(cancelUpload(failed, "k")), false);
});

test("hasUnsavedPhotos is false when the actions end at the loaded list and nothing uploads", () => {
  const field = loadPhotoField(saved("A", "B", "C"));
  assert.equal(hasUnsavedPhotos(field), false);
  assert.equal(hasUnsavedPhotos(makePrimary(makePrimary(field, "B"), "A")), false);
  assert.equal(hasUnsavedPhotos(makePrimary(field, "B")), true);
});

test("saveBlocker points at the first uploading photo, then at the first failed one", () => {
  let { field } = addSelection(loadPhotoField(saved("A")), ["f1", "u2", "u3"]);
  field = failUpload(startUpload(field, "f1", 1), "f1", { failure: "connection", retryable: true });
  assert.deepEqual(saveBlocker(field), { kind: "uploading", key: "u2" });
  field = failUpload(startUpload(field, "u2", 1), "u2", { failure: "connection", retryable: true });
  field = failUpload(startUpload(field, "u3", 1), "u3", { failure: "connection", retryable: true });
  assert.deepEqual(saveBlocker(field), { kind: "failed", key: "f1" });
  assert.equal(saveBlocker(loadPhotoField(saved("A"))), null);
});

test("markRejected marks the photo that produced the sent index", () => {
  let field = markForRemoval(loadPhotoField(saved("A", "B", "C")), "B");
  field = markRejected(field, [1]);
  assert.deepEqual(field.photos.map((photo) => photo.rejected), [false, false, true]);
  assert.deepEqual(markRejected(field, []).photos.map((photo) => photo.rejected), [false, false, false]);
  assert.deepEqual(markRejected(field, [9]).photos.map((photo) => photo.rejected), [false, false, false]);
});

test("uploadFailure reads 413 as dimensions and invalid files as format, neither retryable", () => {
  assert.deepEqual(uploadFailure({ code: "IMAGE_TOO_LARGE" }), { failure: "dimensions", retryable: false });
  assert.deepEqual(uploadFailure({ code: "UNKNOWN", status: 413 }), { failure: "dimensions", retryable: false });
  assert.deepEqual(uploadFailure({ code: "INVALID_IMAGE" }), { failure: "format", retryable: false });
  assert.deepEqual(uploadFailure({ code: "UNSUPPORTED_MEDIA_TYPE" }), { failure: "format", retryable: false });
});

test("uploadFailure reads storage, server, session, unknown and network failures as retryable connection", () => {
  const connection = { failure: "connection", retryable: true };
  for (const code of ["IMAGE_STORAGE_UNAVAILABLE", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "NETWORK_ERROR", "SOMETHING_NEW"]) {
    assert.deepEqual(uploadFailure({ code }), connection);
  }
  assert.deepEqual(uploadFailure({ code: "UNAUTHORIZED", status: 401 }), connection);
});

test("a primary that fails keeps primary until it is retried or removed", () => {
  let { field } = addSelection(loadPhotoField([]), ["k1", "k2"]);
  field = failUpload(startUpload(field, "k1", 1), "k1", { failure: "connection", retryable: true });
  assert.equal(primaryKey(field), "k1");
  const retried = retryUpload(field, "k1");
  assert.equal(retried.photos[0].kind, "uploading");
  assert.equal(primaryKey(retried), "k1");
  assert.equal(primaryKey(cancelUpload(field, "k1")), "k2");
});
