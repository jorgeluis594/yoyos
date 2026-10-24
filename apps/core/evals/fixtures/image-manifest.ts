import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { catalog, type ProductKey } from "@core/evals/fixtures/catalog";

/**
 * The eval photos are listed in `manifest.json` next to them (images/README.md). Image cases, the end-to-end photos and the indexed
 * catalog photos are all read from it, so adding a photo is adding a manifest entry. `EVAL_IMAGES_DIR` points at another folder
 * with the same layout; a folder without a manifest leaves the photo cases out.
 */

const coreDir = resolve(import.meta.dirname, "../..");
export const defaultImagesDir = resolve(import.meta.dirname, "images");

const productKeys = catalog.map(({ key }) => key) as [ProductKey, ...ProductKey[]];

export const manifestEntry = z.strictObject({
  /** Path relative to the manifest's folder: `customer/polo-basico-worn.jpg`. */
  file: z.string().regex(/^[a-z-]+\/[^/]+\.(jpe?g|png|webp)$/i),
  folder: z.enum(["catalog", "customer", "negative", "non-product", "label"]),
  productKey: z.enum(productKeys).nullable(),
  color: z.string().nullable(),
  /** What the photo shows: «worn», «repost-screenshot», «second-color-worn», «payment»… Reported as `kind:<scenario>`. */
  scenario: z.string().min(1),
  expected: z.enum(["match", "no_match", "not_product", "label"]),
  generator: z.string().min(1),
  prompt: z.string().nullable(),
  derivedFrom: z.string().nullable(),
}).refine((entry) => entry.file.startsWith(`${entry.folder}/`), "The file lives in its folder")
  .refine((entry) => (entry.expected !== "match" && entry.expected !== "label") || entry.productKey !== null, "A match or a label names its product")
  .refine((entry) => entry.color === null || entry.productKey === null || entry.expected === "no_match"
    || catalog.find(({ key }) => key === entry.productKey)!.variants.some(({ attributes }) => attributes.Color === entry.color), "The color is one the product sells");
export type ManifestEntry = z.output<typeof manifestEntry>;

export type ImageManifest = Readonly<{ dir: string; entries: readonly ManifestEntry[] }>;

export function imagesDirOf(env: Readonly<Record<string, string | undefined>>): string {
  const dir = env.EVAL_IMAGES_DIR;
  if (!dir) return defaultImagesDir;
  return isAbsolute(dir) ? dir : resolve(coreDir, dir);
}

/** The manifest of a photo folder, or null when the folder has none; an invalid manifest throws. */
export function readImageManifest(dir: string): ImageManifest | null {
  const path = resolve(dir, "manifest.json");
  if (!existsSync(path)) return null;
  const entries = z.array(manifestEntry).parse(JSON.parse(readFileSync(path, "utf8")));
  const missing = entries.filter(({ file }) => !existsSync(resolve(dir, file))).map(({ file }) => file);
  if (missing.length) throw new Error(`Eval photos listed in ${path} are missing: ${missing.join(", ")}`);
  return { dir, entries };
}

/** The photo indexed for a catalog product: its first `catalog/` entry. */
export const catalogPhotoOf = (manifest: ImageManifest, product: ProductKey) =>
  manifest.entries.find((entry) => entry.folder === "catalog" && entry.productKey === product) ?? null;

/** Fields an entry must equal, and a `hint` its file name or scenario must contain. */
export type PhotoPick = Readonly<Partial<Pick<ManifestEntry, "folder" | "productKey" | "color" | "scenario" | "expected">> & { hint?: string }>;

/** The first entry matching the pick, for cases that need «a worn photo of the Polo básico» rather than a file name. */
export function pickPhoto(manifest: ImageManifest, { hint, ...fields }: PhotoPick): ManifestEntry | null {
  return manifest.entries.find((entry) => Object.entries(fields).every(([field, value]) => entry[field as keyof typeof fields] === value)
    && (hint === undefined || entry.file.includes(hint) || entry.scenario.includes(hint))) ?? null;
}
