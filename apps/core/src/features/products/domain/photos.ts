import { err, ok } from "@shared/functional";
import type { Result } from "@shared/result";
import type { ValidationError, ValidationIssue } from "@core/src/features/products/domain/errors";
import type { ImageId, ProductPhotos } from "@core/src/features/products/domain/product";

/** Mirrors `productPhotoLimits` of the shared contract; the domain does not import contracts, and a test keeps both equal. */
export const productPhotoLimits = { maxPhotos: 8 } as const;

const invalid = (issues: readonly ValidationIssue[]) => err<ValidationError>({ code: "VALIDATION_ERROR", message: "Invalid photos", issues: issues as unknown as ValidationError["issues"] });

/** At most the limit and no repeats; a longer list is reported at once, without scanning it. */
export function parseProductPhotos(ids: readonly ImageId[]): Result<ProductPhotos, ValidationError> {
  const maximum = productPhotoLimits.maxPhotos;
  if (ids.length > maximum) return invalid([{ scope: "product", field: "photoIds", reason: "TOO_MANY_PHOTOS", maximum, message: "Too many photos" }]);
  const seen = new Set<ImageId>();
  const issues = ids.flatMap((id, index): ValidationIssue[] => {
    if (seen.has(id)) return [{ scope: "photo", field: "photoIds", index, reason: "DUPLICATE_PHOTO", message: "Repeated photo" }];
    seen.add(id);
    return [];
  });
  return issues.length ? invalid(issues) : ok([...ids] as unknown as ProductPhotos);
}

export const primaryPhoto = (photos: ProductPhotos): ImageId | null => photos[0] ?? null;

export const samePhotos = (a: ProductPhotos, b: ProductPhotos): boolean => a.length === b.length && a.every((id, index) => id === b[index]);
