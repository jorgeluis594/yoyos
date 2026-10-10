import type { CheckoutAppearance } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { defaultCheckoutAppearance } from "@core/src/features/checkout-appearance/domain/checkout-appearance";

export type EditorDraft = Readonly<{ appearance: CheckoutAppearance; logoUrl: string | null }>;
export type PreviewMode = "light" | "dark";

export function sameAppearance(a: CheckoutAppearance, b: CheckoutAppearance): boolean {
  return a.logoImageId === b.logoImageId && a.brandColor === b.brandColor && a.background === b.background;
}

export const resetDraft: EditorDraft = { appearance: defaultCheckoutAppearance, logoUrl: null };
