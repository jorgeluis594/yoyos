import { z } from "zod";
import { storeThemeIds } from "@shared/store-themes";

// Server → buyer: visual data only, no identifiers or dates.
export const publicStoreAppearanceSchema = z.strictObject({
  // `z.httpUrl()` rejects IP and localhost hosts, which local storage endpoints use.
  logoUrl: z.url({ protocol: /^https?$/ }).nullable(),
  theme: z.enum(storeThemeIds),
});

// Editor → preview iframe.
export const storePreviewMessageSchema = z.strictObject({
  type: z.literal("store-appearance:update"),
  appearance: publicStoreAppearanceSchema,
  state: z.enum(["review", "payment"]),
});

// Preview iframe → editor: ready to receive the state.
export const storePreviewReadySchema = z.strictObject({ type: z.literal("store-appearance:ready") });

export type PublicStoreAppearance = z.infer<typeof publicStoreAppearanceSchema>;
export type StorePreviewMessage = z.infer<typeof storePreviewMessageSchema>;
