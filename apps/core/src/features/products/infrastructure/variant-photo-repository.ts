import { z } from "zod";
import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import { log } from "@core/src/shared/infrastructure/logger";
import { getCompanyId, prisma } from "@core/src/shared/infrastructure/persistance";
import { isPersistenceFailure } from "@core/src/shared/infrastructure/persistence-error";
import type { ProductReadError } from "@core/src/features/products/application/repository";
import type { VariantPhotoRow } from "@core/src/features/products/application/variant-photos";
import type { ImageId, VariantId } from "@core/src/features/products/domain/product";

const rowSchema = z.object({ variantId: z.uuid().transform((value) => value as VariantId), imageId: z.uuid().transform((value) => value as ImageId).nullable() });

/** Product image of each variant of the active tenant, whatever the status of the variant or its product. */
export async function findVariantImages(variantIds: readonly VariantId[]): Promise<Result<readonly VariantPhotoRow[], ProductReadError>> {
  try {
    const rows = await prisma.productVariant.findMany({ where: { id: { in: [...variantIds] } }, select: { id: true, product: { select: { imageId: true } } } });
    const parsed = z.array(rowSchema).safeParse(rows.map(({ id, product }) => ({ variantId: id, imageId: product.imageId })));
    if (parsed.success) return ok(parsed.data);
    log.error({ event: "unable_to_read_variant_photos", companyId: getCompanyId(), errorCode: "INVALID_STORED_DATA" }, "unable_to_read_variant_photos");
    return err({ code: "INVALID_STORED_DATA" as const, message: "Stored variant photos are invalid" });
  } catch (cause) {
    if (!isPersistenceFailure(cause)) throw cause;
    log.error({ event: "unable_to_read_variant_photos", companyId: getCompanyId(), errorCode: "PERSISTENCE_UNAVAILABLE", err: cause }, "unable_to_read_variant_photos");
    return err({ code: "PERSISTENCE_UNAVAILABLE" as const, message: "Unable to read variant photos" });
  }
}
