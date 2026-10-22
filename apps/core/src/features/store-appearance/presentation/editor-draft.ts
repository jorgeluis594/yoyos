import type { StoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";
import { defaultStoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";

export type EditorDraft = Readonly<{ appearance: StoreAppearance; logoUrl: string | null }>;

export function sameAppearance(a: StoreAppearance, b: StoreAppearance): boolean {
  return a.logoImageId === b.logoImageId && a.theme === b.theme;
}

export const resetDraft: EditorDraft = { appearance: defaultStoreAppearance, logoUrl: null };
