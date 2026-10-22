import { z } from "zod";
import type { StoreAppearance } from "@core/src/features/store-appearance/domain/store-appearance";
import type { StoreAppearanceFailure } from "@core/src/features/store-appearance/application/store-appearance";

/** The editor route has one action for both of its independent parts; the intent says which one a body is for. */
export const editorActionSchema = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("save-appearance"), appearance: z.unknown() }),
  z.strictObject({ intent: z.literal("set-publication"), published: z.boolean() }),
]);

export type EditorIntent = z.infer<typeof editorActionSchema>["intent"];

/** Every result carries its intent, so the draft and the publication card each read only their own. */
export type EditorActionResult =
  | Readonly<{ intent: "save-appearance"; success: true; appearance: StoreAppearance }>
  | Readonly<{ intent: "save-appearance"; error: StoreAppearanceFailure["code"] }>
  | Readonly<{ intent: "set-publication"; published: boolean }>
  | Readonly<{ intent: "set-publication"; error: true }>;

/** What the loader knows about the logo and theme; `unknown_theme` is a starting point, not an error. */
export type AppearancePart =
  | Readonly<{ kind: "readable"; published: StoreAppearance; logoUrl: string | null }>
  | Readonly<{ kind: "unknown_theme" }>
  | Readonly<{ kind: "failed" }>;

export type PublicationPart =
  | Readonly<{ kind: "loaded"; published: boolean }>
  | Readonly<{ kind: "failed" }>;
