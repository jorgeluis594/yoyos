import { z } from "zod";

export const catalogSettingsSchema = z.strictObject({ published: z.boolean(), url: z.url() });
export type CatalogSettingsResponse = z.infer<typeof catalogSettingsSchema>;
export const setCatalogPublicationSchema = z.strictObject({ published: z.boolean() });
export type SetCatalogPublicationRequest = z.infer<typeof setCatalogPublicationSchema>;
