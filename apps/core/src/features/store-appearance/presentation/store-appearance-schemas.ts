import { z } from "zod";
import { storeThemeIds } from "@shared/store-themes";

// Server → buyer: visual data only, no identifiers or dates.
export const publicStoreAppearanceSchema = z.strictObject({
  // `z.httpUrl()` rejects IP and localhost hosts, which local storage endpoints use.
  logoUrl: z.url({ protocol: /^https?$/ }).nullable(),
  theme: z.enum(storeThemeIds),
});

export type PublicStoreAppearance = z.infer<typeof publicStoreAppearanceSchema>;
