import { posix } from "node:path";

/** JavaScript files by path relative to the output directory, with forward slashes. */
export type ScriptSources = Readonly<Record<string, string>>;

const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const srcAttribute = /\ssrc\s*=\s*["']([^"']+)["']/i;
const importSpecifier = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

function specifiersIn(code: string): string[] {
  return [...code.matchAll(importSpecifier)].map((match) => match[1] ?? "");
}

function pageSpecifiers(html: string): string[] {
  return [...html.matchAll(scriptTag)].flatMap((match) => {
    const source = srcAttribute.exec(match[1] ?? "")?.[1];
    return source ? [source] : specifiersIn(match[2] ?? "");
  });
}

/** Resolves a specifier found in `importer` (a path relative to the output directory) to an output path. */
function resolveSpecifier(specifier: string, importer: string): string | undefined {
  const path = specifier.split(/[?#]/)[0] ?? "";
  if (path.startsWith("/")) return path.slice(1);
  if (path.startsWith("./") || path.startsWith("../")) return posix.join(posix.dirname(importer), path);
  return undefined;
}

/** Scripts no page loads, neither through `<script src>` nor through the imports of a loaded script. */
export function findUnreferencedScripts(pages: readonly string[], scripts: ScriptSources): string[] {
  const reachable = new Set<string>();
  const visit = (file: string | undefined): void => {
    if (file === undefined || !(file in scripts) || reachable.has(file)) return;
    reachable.add(file);
    for (const specifier of specifiersIn(scripts[file] ?? "")) visit(resolveSpecifier(specifier, file));
  };
  for (const html of pages) for (const specifier of pageSpecifiers(html)) visit(resolveSpecifier(specifier, "index.html"));
  return Object.keys(scripts)
    .filter((file) => !reachable.has(file))
    .sort();
}
