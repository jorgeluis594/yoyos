import { err, ok } from "@shared/functional";
import { releaseImage, viewImage } from "@mobile/features/whatsapp/application/view-image";
import type { MessageStore } from "@mobile/features/whatsapp/application/ports";
import type { CompanyId, ImageDownloadReference, NativeMessageId } from "@mobile/features/whatsapp/domain/ids";

const id = "wa-message:v1:m1" as NativeMessageId;
const reference = "wa-image:v1:secret" as ImageDownloadReference;
const image = { uri: "file:///private/a.jpg", mimeType: "image/jpeg", size: 3 };
const store = { findImage: async (company: CompanyId) => ok(company === "c1" ? { messageId: id, reference } : null) } as Pick<MessageStore, "findImage">;

test("downloads the image reference found for the session company", async () => {
  const downloadImage = jest.fn(async () => ok(image));
  expect(await viewImage({ store, whatsapp: { downloadImage } })("c1" as CompanyId, id)).toEqual({ success: true, data: image });
  expect(downloadImage).toHaveBeenCalledWith({ messageId: id, downloadReference: reference });
});

test("returns NOT_FOUND for another company's message or a text message", async () => {
  const downloadImage = jest.fn();
  expect(await viewImage({ store, whatsapp: { downloadImage } })("c2" as CompanyId, id)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  expect(downloadImage).not.toHaveBeenCalled();
});

test("propagates IMAGE_UNAVAILABLE, IMAGE_DOWNLOAD_FAILED and STORAGE_LIMIT_REACHED", async () => {
  for (const code of ["IMAGE_UNAVAILABLE", "IMAGE_DOWNLOAD_FAILED", "STORAGE_LIMIT_REACHED"] as const) {
    const downloadImage = async () => err({ code, message: "m" });
    expect(await viewImage({ store, whatsapp: { downloadImage } })("c1" as CompanyId, id)).toMatchObject({ success: false, error: { code } });
  }
});

test("propagates storage failures without downloading", async () => {
  const failing = { findImage: async () => err({ code: "LOCAL_STORAGE_FAILED" as const, message: "x" }) };
  expect(await viewImage({ store: failing, whatsapp: { downloadImage: jest.fn() } })("c1" as CompanyId, id)).toMatchObject({ error: { code: "LOCAL_STORAGE_FAILED" } });
});

test("releaseImage deletes the downloaded file", async () => {
  const deleteDownloadedImage = jest.fn(async () => ok(undefined));
  expect(await releaseImage({ whatsapp: { deleteDownloadedImage } })(id)).toEqual({ success: true, data: undefined });
  expect(deleteDownloadedImage).toHaveBeenCalledWith(id);
});
