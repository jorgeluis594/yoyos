import { z } from "zod";
import { storeThemeIds } from "@shared/store-themes";

const httpUrl = z.url({ protocol: /^https?$/ });
export const storeThemeIdSchema = z.enum(storeThemeIds);
// `url` is null when the stored logo exists but cannot be resolved; the id is kept so a save does not erase it.
export const storeLogoSchema = z.strictObject({ id: z.uuid(), url: httpUrl.nullable() });
export const storeAppearanceSchema = z.strictObject({ theme: storeThemeIdSchema, logo: storeLogoSchema.nullable() });
export const storeAppearanceResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("readable"), appearance: storeAppearanceSchema }),
  z.strictObject({ kind: z.literal("unknown_theme") }),
]);
export const saveStoreAppearanceSchema = z.strictObject({ theme: storeThemeIdSchema, logoImageId: z.uuid().nullable() });
export type StoreAppearanceResponse = z.infer<typeof storeAppearanceResponseSchema>;
export type SaveStoreAppearanceBody = z.infer<typeof saveStoreAppearanceSchema>;
