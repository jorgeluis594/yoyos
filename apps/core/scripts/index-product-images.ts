import type { CompanyId } from "@shared/identity";
import { applicationEventBus } from "@core/src/composition/event-bus";
import { imageEmbedder } from "@core/src/features/products/composition";
import { listProductsMissingEmbedding } from "@core/src/features/products/infrastructure/product-image-embeddings";
import { systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

/** Publishes product_image_changed for every product missing an embedding of the current model; the worker indexes them. */
export async function indexProductImages() {
  if (!imageEmbedder) throw new Error("Visual search is disabled: configure the image embedder provider key");
  const { model } = imageEmbedder;
  const { provider, publishEvent } = applicationEventBus();
  await provider.start();
  try {
    let published = 0;
    // Company has FORCE RLS for core_app, so companies are found through their users (auth tables have no RLS).
    // Complete by invariant: only a company user creates products, so a company without users has nothing to index.
    const users = await systemPrisma.user.findMany({ where: { companyId: { not: null } }, select: { companyId: true }, distinct: ["companyId"] });
    for (const { companyId: id } of users) {
      const companyId = id as CompanyId;
      await withTenantIsolation(companyId, async () => {
        const missing = await listProductsMissingEmbedding(model);
        if (!missing.success) throw new Error(missing.error.message);
        for (const productId of missing.data) {
          const result = await publishEvent("product_image_changed", { companyId, productId });
          if (!result.success) throw new Error(result.error.message);
          published++;
        }
      });
    }
    console.log(`Published product_image_changed for ${published} products (model ${model})`);
  } finally {
    await provider.stop();
  }
}

try {
  await indexProductImages();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await systemPrisma.$disconnect();
}
