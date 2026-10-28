import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { ok } from "@shared/functional";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findImageIndexState, saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { indexProductImage } from "@core/src/features/products/application/index-product-image";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { ImageEmbedder } from "@core/src/features/products/composition";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";
import { catalog, evalId, variantIdOf } from "@core/evals/fixtures/catalog";
import { catalogPhotoOf, imagesDirOf, readImageManifest } from "@core/evals/fixtures/image-manifest";

/**
 * The eval company lives in the test database with fixed ids and is recreated at the start of each suite, so every run sees the same
 * catalog. Image bytes are read from the fixture files instead of R2: storage is the only faked port.
 */

export const evalCompanyId = evalId("company");
export const evalSellerId = evalId("seller");

const coreDir = resolve(import.meta.dirname, "../..");

/** Fixture paths are relative to the photo folder (`EVAL_IMAGES_DIR`, default `evals/fixtures/images`), or to `apps/core` when they start with `src/`. */
export const fixturePath = (file: string) => file.startsWith("src/") ? resolve(coreDir, file) : resolve(imagesDirOf(process.env), file);

const imageFiles = new Map<string, string>();

export function registerImageFile(imageId: string, file: string): void {
  imageFiles.set(imageId, fixturePath(file));
}

const contentTypeOf = (file: string): ImageBytes["contentType"] => {
  const extension = extname(file).toLowerCase();
  return extension === ".webp" ? "image/webp" : extension === ".png" ? "image/png" : "image/jpeg";
};

export async function readFixtureImage(file: string): Promise<ImageBytes> {
  const bytes = new Uint8Array(await readFile(fixturePath(file)));
  return { bytes, contentType: contentTypeOf(file) };
}

/** The `readImage` port over registered fixture files; an unknown id is a deleted image. */
export async function readRegisteredImage(imageId: ImageId) {
  const file = imageFiles.get(imageId);
  if (!file) return { success: false as const, error: { code: "IMAGE_NOT_FOUND" as const, message: "Image not registered" } };
  const bytes = new Uint8Array(await readFile(file));
  return ok<ImageBytes>({ bytes, contentType: contentTypeOf(file) });
}

const companyTables = ["chatMessageOutcome", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer",
  "productStock", "productVariant", "productOption", "product", "image"] as const;

async function deleteEvalCompany() {
  await withTenantIsolation(evalCompanyId, async () => {
    for (const table of companyTables) await (prisma[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
    await systemPrisma.user.deleteMany({ where: { companyId: evalCompanyId } });
    await prisma.company.deleteMany({ where: { id: evalCompanyId } });
  });
}

/**
 * The photo of each product that has one (`photo` in catalog.ts), from the manifest's `catalog/` entries. Without a manifest the
 * products are seeded without photos, which only the passes that read no product photo accept.
 */
function catalogPhotos(required: boolean): ReadonlyMap<string, string> {
  const manifest = readImageManifest(imagesDirOf(process.env));
  const photos = new Map<string, string>();
  for (const product of catalog.filter(({ photo }) => photo)) {
    const entry = manifest ? catalogPhotoOf(manifest, product.key) : null;
    if (entry) photos.set(product.key, entry.file);
    else if (required) throw new Error(`No catalog photo of ${product.key} in the photo manifest (evals/fixtures/images/README.md)`);
  }
  return photos;
}

/** Recreates the eval company and catalog, and indexes every product photo with the configured embedder (null skips indexing). */
export async function seedEvalCatalog(embedder: ImageEmbedder | null): Promise<void> {
  const photos = catalogPhotos(embedder !== null);
  await deleteEvalCompany();
  const now = new Date();
  await withTenantIsolation(evalCompanyId, async () => {
    await prisma.company.create({ data: { id: evalCompanyId, name: "Moda Yoyis (evals)", country: "PE" } });
    await systemPrisma.user.create({ data: { id: evalSellerId, name: "Vendedora", email: `${evalSellerId}@evals.yoyos.test`, companyId: evalCompanyId } });
    for (const product of catalog) {
      const productId = evalId(`product:${product.key}`);
      const photo = photos.get(product.key);
      const imageId = photo ? evalId(`image:${product.key}`) : null;
      if (imageId && photo) {
        await prisma.image.create({ data: { id: imageId, storageKey: `evals/${photo}` } });
        registerImageFile(imageId, photo);
      }
      await seedProduct({ id: productId, name: product.name, qrCode: productId, imageId, createdAt: now, updatedAt: now, variants: product.variants.map((variant) => {
        const variantId = variantIdOf(product.key, variant.attributes);
        return { id: variantId, attributes: variant.attributes, sku: `EVAL-${variantId.slice(0, 8)}`, salePrice: variant.price, qrCode: variantId };
      }) });
    }
  });
  if (!embedder) return;
  for (const product of catalog.filter(({ key }) => photos.has(key))) {
    const indexed = await withTenantIsolation(evalCompanyId, () => indexProductImage({ productId: evalId(`product:${product.key}`) as ProductId }, {
      findImageIndexState, saveEmbedding, embedImage: embedder.embedImage, model: embedder.model, readImage: readRegisteredImage,
    }));
    if (!indexed.success || indexed.data.kind !== "indexed") throw new Error(`Indexing ${product.key} failed: ${JSON.stringify(indexed)}`);
  }
}
