import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
// Relative import: astro.config.ts loads this file before the aliases exist.
import { findUnreferencedScripts } from "../lib/unreferenced-scripts";

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Astro emits the chunks of components a page does not render; this removes what no page loads. */
export function pruneUnreferencedScripts(): AstroIntegration {
  return {
    name: "prune-unreferenced-scripts",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const root = fileURLToPath(dir);
        const files = filesUnder(root);
        const pages = files.filter((file) => file.endsWith(".html")).map((file) => readFileSync(file, "utf8"));
        const scripts: Record<string, string> = {};
        for (const file of files.filter((candidate) => candidate.endsWith(".js"))) {
          scripts[relative(root, file).split(sep).join("/")] = readFileSync(file, "utf8");
        }
        const removed = findUnreferencedScripts(pages, scripts);
        for (const file of removed) {
          rmSync(join(root, file));
          rmSync(join(root, `${file}.map`), { force: true });
        }
        if (removed.length > 0) console.error(JSON.stringify({ event: "pruned_unreferenced_scripts", files: removed }));
      },
    },
  };
}
