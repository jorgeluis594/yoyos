import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { EvalCase } from "@core/evals/cases/schema";

/**
 * The seed bank: the cases the staged reader is measured on first (technical design T7). It is the ids of the PR #313 comment «Ejemplos que fallaron en
 * las pruebas» plus the four families it found. The holdout v4 ids are private: they live in `<EVAL_PRIVATE_DIR>/seed-bank.json`, never in the repository.
 */

export const seedBank = {
  /** The failures of the frozen test split in #313 (paraphrases by their own id). */
  frozenTest: ["int-ready-confirmo", "int-ready-confirmo~p1", "int-ready-confirmo~p2", "int-price-one-sol-existing", "int-price-one-sol-existing~p1", "conv-unnamed-add-after-photo",
    "hold-price-offer-below", "int-injection-caption", "int-photo-decline~p2", "conv-orderless-pending-chompa-paid", "conv-pending-product-deactivated"],
  /** The failures of the dev split in #313. */
  dev: ["int-variant-only-la-quiero", "int-variant-only-la-quiero~p1", "int-unnamed-uno-mas", "int-qty-one-more-named", "int-qty-set-named", "int-qty-two-items-same-product",
    "int-unnamed-set-two-items", "conv-photo-set-with-values", "conv-two-units-one-assigned", "int-price-identified-product-2", "int-price-one-sol-new", "int-price-reais~p1",
    "int-photo-price-each~p2", "int-variant-not-available", "int-photo-names-other-product", "int-add-and-remove~p2", "int-remove-and-ready~p2", "conv-photo-rayas-size-after-ask",
    "hold-no-order-variant"],
  /** The four families of #313's «Patrones», selected from the committed cases by kind or id prefix (base cases, no paraphrases). */
  families: {
    "confirmations-and-payment-questions": { kinds: ["payment-request", "payment-boundary", "payment-with-pending", "payment-closed"], idPrefixes: ["int-ready-confirmo"] },
    "quantities-after-photo": { kinds: ["photo-quantity", "pending-quantity", "named-quantity"], idPrefixes: [] },
    "mentioned-prices": { kinds: ["price"], idPrefixes: [] },
    "variant-only-text": { kinds: [], idPrefixes: ["int-variant-only-"] },
  },
} as const;

export type SeedFamily = keyof typeof seedBank.families;

export const committedSeedIds = (): readonly string[] => [...seedBank.frozenTest, ...seedBank.dev];

export function familyCases(cases: readonly EvalCase[], family: SeedFamily): readonly EvalCase[] {
  const { kinds, idPrefixes } = seedBank.families[family];
  return cases.filter((testCase) => !testCase.paraphraseOf && ((kinds as readonly string[]).includes(testCase.kind) || idPrefixes.some((prefix) => testCase.id.startsWith(prefix))));
}

const privateSeedFile = z.strictObject({ ids: z.array(z.string().min(1)) });

/** The holdout ids of `<dir>/seed-bank.json`; none when the folder has no such file. A failure names the file, never its content. */
export function privateSeedIds(dir: string): readonly string[] {
  const path = join(dir, "seed-bank.json");
  if (!existsSync(path)) return [];
  const parsed = privateSeedFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error("seed-bank.json is malformed: expected { ids: string[] } and nothing else");
  return parsed.data.ids;
}

export type ResolvedSeedBank = Readonly<{ cases: readonly EvalCase[]; missing: readonly string[] }>;

/** The seed bank over the committed cases and the private ones. Unresolved committed ids are named; unresolved private ids only by position. */
export function resolveSeedBank(committed: readonly EvalCase[], privateCases: readonly EvalCase[], privateIds: readonly string[]): ResolvedSeedBank {
  const byId = new Map(committed.map((testCase) => [testCase.id, testCase] as const));
  const privateById = new Map(privateCases.map((testCase) => [testCase.id, testCase] as const));
  const missing = [
    ...committedSeedIds().filter((id) => !byId.has(id)),
    ...privateIds.flatMap((id, index) => privateById.has(id) ? [] : [`private id ${index + 1}`]),
  ];
  const families = (Object.keys(seedBank.families) as SeedFamily[]).flatMap((family) => familyCases(committed, family));
  const picked = [...committedSeedIds().flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), ...families, ...privateIds.flatMap((id) => privateById.has(id) ? [privateById.get(id)!] : [])];
  return { cases: [...new Map(picked.map((testCase) => [testCase.id, testCase] as const)).values()], missing };
}
