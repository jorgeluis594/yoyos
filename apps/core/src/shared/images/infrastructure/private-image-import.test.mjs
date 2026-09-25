import sharp from "sharp";
import { expect, test } from "vitest";

test("private image imports reuse their reservation after a completion interruption", async () => {
  const appUrl = process.env.DATABASE_URL;
  expect(appUrl, "run sh scripts/run-tests.sh integration to prepare core_test").toBeTruthy();
  const companyId = crypto.randomUUID();
  const sourceKey = `whatsapp-message:${crypto.randomUUID()}`;
  const { prisma, withTenantIsolation } = await import("@core/src/shared/infrastructure/persistance");
  const { importPrivateImage, readPrivateImage } = await import("@core/src/shared/images/application/images.ts");
  const { imageRepository } = await import("@core/src/shared/images/infrastructure/image-repository.ts");
  const bytes = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 3, background: "teal" } }).png().toBuffer());
  const objects = new Map();
  const uploads = [];
  const storage = {
    upload: async () => ({ success: false, error: { code: "unused", message: "unused" } }),
    uploadPrivate: async (key, file) => { uploads.push(key); objects.set(key, file); return { success: true, data: undefined }; },
    readPrivate: async (key) => ({ success: true, data: { ...objects.get(key), contentType: "image/png" } }),
    getUrl: async () => ({ success: false, error: { code: "unused", message: "unused" } }),
    delete: async () => ({ success: true, data: undefined }),
  };
  let interrupted = true;
  const repository = {
    ...imageRepository,
    async completeImport(...args) {
      if (interrupted) { interrupted = false; return { success: false, error: { code: "PERSISTENCE_UNAVAILABLE", message: "temporary failure" } }; }
      return imageRepository.completeImport(...args);
    },
  };

  try {
    await withTenantIsolation(companyId, async () => await prisma.company.create({ data: { id: companyId, name: "Private image test", country: "PE" } }));
    await withTenantIsolation(companyId, async () => {
      expect(await importPrivateImage(companyId, sourceKey, { bytes, filename: "original.png", declaredContentType: "image/png" }, storage, repository)).toMatchObject({ success: false, error: { code: "PERSISTENCE_UNAVAILABLE" } });
      const reserved = await prisma.image.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey } }, select: { id: true, importStatus: true } });
      expect(reserved).toMatchObject({ importStatus: "pending" });
      expect(await imageRepository.find(companyId, reserved.id)).toEqual({ success: true, data: null });
      const retried = await importPrivateImage(companyId, sourceKey, { bytes, filename: "original.png", declaredContentType: "image/png" }, storage, repository);
      expect(retried).toEqual({ success: true, data: { id: reserved.id } });
      expect(uploads).toHaveLength(2);
      expect(uploads[0]).toBe(uploads[1]);
      expect((await imageRepository.find(companyId, reserved.id)).data).toMatchObject({ visibility: "private" });
      expect(await readPrivateImage(companyId, reserved.id, storage, imageRepository)).toEqual({ success: true, data: { bytes, contentType: "image/png" } });
    });
  } finally {
    await withTenantIsolation(companyId, async () => {
      await prisma.chatMessage.deleteMany({ where: { companyId } });
      await prisma.image.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    });
  }
});
