import { z } from "zod";
import { checkoutBackgrounds, checkoutBrandColors } from "@core/src/features/checkout-appearance/domain/checkout-appearance";

// Server → buyer: visual data only, no identifiers or dates.
export const publicCheckoutAppearanceSchema = z.strictObject({
  // `z.httpUrl()` rejects IP and localhost hosts, which local storage endpoints use.
  logoUrl: z.url({ protocol: /^https?$/ }).nullable(),
  brandColor: z.enum(checkoutBrandColors),
  background: z.enum(checkoutBackgrounds),
});

// Editor → preview iframe.
export const checkoutPreviewMessageSchema = z.strictObject({
  type: z.literal("checkout-appearance:update"),
  appearance: publicCheckoutAppearanceSchema,
  mode: z.enum(["light", "dark"]),
  state: z.enum(["review", "payment"]),
});

// Preview iframe → editor: ready to receive the state.
export const checkoutPreviewReadySchema = z.strictObject({ type: z.literal("checkout-appearance:ready") });

export type PublicCheckoutAppearance = z.infer<typeof publicCheckoutAppearanceSchema>;
export type CheckoutPreviewMessage = z.infer<typeof checkoutPreviewMessageSchema>;
export type CheckoutPreviewMode = CheckoutPreviewMessage["mode"];
