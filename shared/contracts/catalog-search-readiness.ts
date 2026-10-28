import { z } from "zod";

export const catalogSearchReadinessResponseSchema = z.strictObject({
  version: z.literal(1),
  state: z.enum(["no_active_products", "no_searchable_photos", "ready"]),
});
export type CatalogSearchReadinessResponse = z.infer<typeof catalogSearchReadinessResponseSchema>;
