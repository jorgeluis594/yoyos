import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { variants, type VariantName } from "./variants";

const root = fileURLToPath(new URL("../..", import.meta.url));
const astroBin = fileURLToPath(new URL("../../node_modules/astro/bin/astro.mjs", import.meta.url));

function build(name: VariantName): void {
  execFileSync(process.execPath, [astroBin, "build", "--outDir", `tests/build-output/.dist/${name}`], {
    cwd: root,
    env: { ...process.env, ...variants[name], NODE_ENV: "production" },
    stdio: "pipe",
  });
}

export default function setup(): void {
  rmSync(fileURLToPath(new URL("./.dist", import.meta.url)), { recursive: true, force: true });
  for (const name of Object.keys(variants) as VariantName[]) build(name);
}
