import { summarizeSoldVariants } from "@core/src/features/orders/application/summarize-sold-variants";
import { findVariantSaleDates } from "@core/src/features/orders/application/find-variant-sale-dates";
import { readSaleDates, readSoldVariants } from "@core/src/features/orders/infrastructure/sold-variants-repository";

/** The ranking reads of the best-sellers and unsold-products tools; `composition.ts` spreads them into `orders`. They join the open sales snapshot. */
export const soldVariantsOperations = {
  summarizeSoldVariants: (input: Parameters<typeof summarizeSoldVariants>[0], access: Parameters<typeof summarizeSoldVariants>[1]) =>
    summarizeSoldVariants(input, access, { readSoldVariants }),
  findVariantSaleDates: (input: Parameters<typeof findVariantSaleDates>[0], access: Parameters<typeof findVariantSaleDates>[1]) =>
    findVariantSaleDates(input, access, { readSaleDates }),
};
