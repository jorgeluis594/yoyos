import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { systemPrisma } from "@core/src/shared/infrastructure/persistance";

let server: ChildProcess;
const port = process.env.CORE_E2E_PORT ?? "4173";

export async function setup() {
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/server.jsonl", "");
  server = spawn("node", ["--import", "tsx", "tests/e2e/server.ts"], { env: {
    ...process.env, PORT: port,
    R2_ENDPOINT: process.env.R2_ENDPOINT ?? `http://127.0.0.1:${Number(port) + 1000}`, // message-to-order.spec.ts serves a fake S3 here
    R2_BUCKET: process.env.R2_BUCKET ?? "test-images",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "test",
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "test",
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}/test-images`,
  }, stdio: ["ignore", "pipe", "inherit"] });
  server.stdout?.on("data", (chunk) => { appendFileSync("test-results/server.jsonl", chunk); process.stdout.write(chunk); });
  for (let attempt = 0; attempt < 240; attempt++) {
    if (server.exitCode !== null) throw new Error(`Core server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill();
  throw new Error("Core server did not start within 120 seconds");
}

export async function teardown() {
  server?.kill();
  if (server && server.exitCode === null) await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  await systemPrisma.$disconnect();
}
