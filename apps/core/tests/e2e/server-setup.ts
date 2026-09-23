import { spawn, type ChildProcess } from "node:child_process";

let server: ChildProcess;

export async function setup() {
  server = spawn("node", ["--import", "tsx", "src/server.ts"], { env: { ...process.env, PORT: "4173" }, stdio: "inherit" });
  for (let attempt = 0; attempt < 240; attempt++) {
    if (server.exitCode !== null) throw new Error(`Core server exited with code ${server.exitCode}`);
    try {
      const response = await fetch("http://127.0.0.1:4173/login");
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill();
  throw new Error("Core server did not start within 120 seconds");
}

export function teardown() {
  server?.kill();
}
