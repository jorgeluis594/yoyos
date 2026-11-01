import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { allCases } from "@core/evals/cases";
import { committedSeedIds, familyCases, privateSeedIds, resolveSeedBank, seedBank } from "@core/evals/cases/seed-bank";
import { splitOfCase } from "@core/evals/cases/split";

describe("seed bank", () => {
  test("every seed-bank id resolves to a committed or private case", () => {
    const resolved = resolveSeedBank(allCases, [], []);

    expect(resolved.missing).toEqual([]);
    expect(committedSeedIds().length).toBe(seedBank.frozenTest.length + seedBank.dev.length);
    expect(seedBank.frozenTest).toHaveLength(11);
    expect(seedBank.dev.length).toBeGreaterThanOrEqual(17);
    for (const family of Object.keys(seedBank.families)) expect(familyCases(allCases, family as keyof typeof seedBank.families).length, family).toBeGreaterThan(0);
    // A private id resolves against the private cases and a stray one is reported, by position only.
    const privateCase = { ...allCases[0]!, id: "pv-seed-a" };
    expect(resolveSeedBank(allCases, [privateCase], ["pv-seed-a"]).missing).toEqual([]);
    expect(resolveSeedBank(allCases, [privateCase], ["pv-seed-a", "pv-gone"]).missing).toEqual(["private id 2"]);
  });

  test("the frozen-test ids fall in the test split and the dev ids in the dev split", () => {
    const byId = new Map(allCases.map((testCase) => [testCase.id, testCase] as const));

    for (const id of seedBank.frozenTest) expect(splitOfCase(byId.get(id)!), id).toBe("test");
    for (const id of seedBank.dev) expect(splitOfCase(byId.get(id)!), id).toBe("dev");
  });

  test("reads the holdout ids from the private folder and nowhere in the repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "seed-bank-"));
    expect(privateSeedIds(dir)).toEqual([]);
    writeFileSync(join(dir, "seed-bank.json"), JSON.stringify({ ids: ["pv-1", "pv-2"] }));
    expect(privateSeedIds(dir)).toEqual(["pv-1", "pv-2"]);
    writeFileSync(join(dir, "seed-bank.json"), JSON.stringify({ ids: ["pv-1"], text: "quiero" }));
    expect(() => privateSeedIds(dir)).toThrow("seed-bank.json");
    writeFileSync(join(dir, "seed-bank.json"), '{"ids": [secret-id-1');
    expect(() => privateSeedIds(dir)).toThrow("seed-bank.json");
    expect(() => privateSeedIds(dir)).not.toThrow(/secret/);
  });

  test("no id of the private holdout v4 exists in the repository's evals", () => {
    const marker = new RegExp(`${"hv"}${"4"}-`);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? (name === "images" ? [] : walk(path)) : /\.(ts|md|json)$/.test(name) ? [path] : [];
    });

    const offenders = walk(resolve(import.meta.dirname, "..")).filter((path) => marker.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
