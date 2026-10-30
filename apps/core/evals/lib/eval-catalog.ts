import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { ok } from "@shared/functional";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";
import { findPhotoIndexState, saveEmbedding } from "@core/src/features/products/infrastructure/image-embeddings";
import { indexProductPhotos } from "@core/src/features/products/application/index-product-photos";
import { seedProduct } from "@core/src/features/products/infrastructure/product-seed";
import type { ImageEmbedder } from "@core/src/features/products/composition";
import type { ImageId, ProductId } from "@core/src/features/products/domain/product";
import type { ImageBytes } from "@core/src/features/products/domain/image-identification";
import { catalogOf, evalId, productIdOf, registerCatalog, variantIdOf, type CatalogScope, type EvalCatalog } from "@core/evals/fixtures/catalog";
import { catalogPhotoOf, imagesDirOf, readImageManifest } from "@core/evals/fixtures/image-manifest";

/**
 * The eval companies live in the test database with fixed ids and are recreated at the start of each suite, so every run sees the same
 * catalog. The committed catalog goes into `evalCompanyId`; a private catalog (`EVAL_PRIVATE_DIR`) into `privateCompanyId`, with its
 * own ids. Image bytes are read from the fixture files instead of R2: storage is the only faked port.
 */

export const evalCompanyId = evalId("company");
export const evalSellerId = evalId("seller");
export const privateCompanyId = evalId("company:private");
export const privateSellerId = evalId("seller:private");

export const scopeOfCompany = (companyId: string): CatalogScope => companyId === privateCompanyId ? "private" : "eval";
export const sellerOfCompany = (companyId: string) => companyId === privateCompanyId ? privateSellerId : evalSellerId;

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

/** The `readImages` port of the visual search over registered fixture files: one result per id, in the order asked. */
export async function readRegisteredImages(imageIds: readonly ImageId[]) {
  return ok(await Promise.all(imageIds.map((imageId) => readRegisteredImage(imageId))));
}

const companyTables = ["chatMessageOutcome", "orderMessage", "payment", "orderItem", "order", "chatMessage", "chat", "contact", "customer",
  "productStock", "productVariant", "productOption", "product", "image"] as const;

async function deleteEvalCompany(companyId: string) {
  await withTenantIsolation(companyId, async () => {
    for (const table of companyTables) await (prisma[table] as unknown as { deleteMany(): Promise<unknown> }).deleteMany();
    await systemPrisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
}

/**
 * The photo of each product that has one (`photo` in the catalog), from the manifest's `catalog/` entries. Without a manifest the
 * products are seeded without photos, which only the passes that read no product photo accept. Only the committed catalog has photos.
 */
function catalogPhotos(catalog: EvalCatalog, scope: CatalogScope, required: boolean): ReadonlyMap<string, string> {
  const photos = new Map<string, string>();
  if (scope !== "eval") return photos;
  const manifest = readImageManifest(imagesDirOf(process.env));
  for (const product of catalog.products.filter(({ photo }) => photo)) {
    const entry = manifest ? catalogPhotoOf(manifest, product.key) : null;
    if (entry) photos.set(product.key, entry.file);
    else if (required) throw new Error(`No catalog photo of ${product.key} in the photo manifest (evals/fixtures/images/README.md)`);
  }
  return photos;
}

/**
 * Recreates an eval company and seeds `catalog` into it, indexing every product photo with the configured embedder (null skips
 * indexing). The catalog is registered for the id lookups.
 */
export async function seedEvalCatalog(catalog: EvalCatalog, companyId: string, embedder: ImageEmbedder | null): Promise<void> {
  const scope = scopeOfCompany(companyId);
  const sellerId = sellerOfCompany(companyId);
  registerCatalog(scope, catalog);
  const photos = catalogPhotos(catalog, scope, embedder !== null);
  await deleteEvalCompany(companyId);
  const now = new Date();
  await withTenantIsolation(companyId, async () => {
    await prisma.company.create({ data: { id: companyId, name: scope === "eval" ? "Moda Yoyis (evals)" : "Tienda privada (evals)", country: "PE" } });
    await systemPrisma.user.create({ data: { id: sellerId, name: "Vendedora", email: `${sellerId}@evals.yoyos.test`, companyId } });
    for (const product of catalog.products) {
      const productId = productIdOf(product.key, scope);
      const photo = photos.get(product.key);
      const imageId = photo ? evalId(`image:${product.key}`) : null;
      if (imageId && photo) {
        await prisma.image.create({ data: { id: imageId, storageKey: `evals/${photo}` } });
        registerImageFile(imageId, photo);
      }
      await seedProduct({ id: productId, name: product.name, qrCode: productId, photoIds: imageId ? [imageId] : [], createdAt: now, updatedAt: now, variants: product.variants.map((variant) => {
        const variantId = variantIdOf(product.key, variant.attributes, scope);
        return { id: variantId, attributes: variant.attributes, sku: `EVAL-${variantId.slice(0, 8)}`, salePrice: variant.price, qrCode: variantId, stock: 1000,
          status: product.active && variant.active ? "active" as const : "inactive" as const };
      }) });
    }
  });
  if (!embedder) return;
  for (const product of catalogOf(scope).products.filter(({ key }) => photos.has(key))) {
    const indexed = await withTenantIsolation(companyId, () => indexProductPhotos({ productId: productIdOf(product.key, scope) as ProductId }, {
      findPhotoIndexState, saveEmbedding, embedImage: embedder.embedImage, model: embedder.model, readImage: readRegisteredImage,
    }));
    if (!indexed.success || indexed.data.kind !== "processed" || indexed.data.failed.length) throw new Error(`Indexing ${product.key} failed: ${JSON.stringify(indexed)}`);
  }
}
