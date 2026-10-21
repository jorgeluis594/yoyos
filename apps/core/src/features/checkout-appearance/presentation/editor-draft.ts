import type { CheckoutAppearance } from "@core/src/features/checkout-appearance/domain/checkout-appearance";
import { defaultCheckoutAppearance } from "@core/src/features/checkout-appearance/domain/checkout-appearance";

export type EditorDraft = Readonly<{ appearance: CheckoutAppearance; logoUrl: string | null }>;

export function sameAppearance(a: CheckoutAppearance, b: CheckoutAppearance): boolean {
  return a.logoImageId === b.logoImageId && a.theme === b.theme;
}

export const resetDraft: EditorDraft = { appearance: defaultCheckoutAppearance, logoUrl: null };
