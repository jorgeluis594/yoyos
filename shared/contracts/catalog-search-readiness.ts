import { z } from "zod";

export const catalogSearchReadinessResponseSchema = z.strictObject({
  version: z.literal(1),
  state: z.enum(["no_active_products", "all_products_hidden", "no_searchable_photos", "ready"]),
});
export type CatalogSearchReadinessResponse = z.infer<typeof catalogSearchReadinessResponseSchema>;
export type CatalogSearchReadinessState = CatalogSearchReadinessResponse["state"];
