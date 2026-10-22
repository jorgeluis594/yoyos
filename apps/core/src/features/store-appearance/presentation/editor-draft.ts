import type { StoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";
import { defaultStoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";

export type EditorDraft = Readonly<{ appearance: StoreAppearance; logoUrl: string | null }>;

/** What the loader read of the stored appearance; `failed` has no draft until a read succeeds. */
export type EditorSource =
  | Readonly<{ kind: "readable"; published: StoreAppearance; logoUrl: string | null }>
  | Readonly<{ kind: "unknown_theme" }>
  | Readonly<{ kind: "failed" }>;

export function sameAppearance(a: StoreAppearance, b: StoreAppearance): boolean {
  return a.logoImageId === b.logoImageId && a.theme === b.theme;
}

export const resetDraft: EditorDraft = { appearance: defaultStoreAppearance, logoUrl: null };

/** The published state the draft is compared against. An unknown stored theme shows what buyers see: Clásico without logo. */
export function baselineOf(source: EditorSource): EditorDraft | null {
  if (source.kind === "failed") return null;
  return source.kind === "readable" ? { appearance: source.published, logoUrl: source.logoUrl } : resetDraft;
}
