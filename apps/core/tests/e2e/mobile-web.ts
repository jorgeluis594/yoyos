import { createServer, request as proxyRequest } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Expo Web exercises the actual mobile screens. This local proxy gives its
// browser requests the same HTTP access to core that native fetch has.
export async function startMobileWeb() {
  const available = createServer();
  await new Promise<void>((resolve) => available.listen(0, "127.0.0.1", resolve));
  const metroAddress = available.address();
  if (!metroAddress || typeof metroAddress === "string") throw new Error("Missing Metro port");
  const metroPort = metroAddress.port;
  await new Promise<void>((resolve) => available.close(() => resolve()));
  const coreOrigin = `http://127.0.0.1:${process.env.CORE_E2E_PORT ?? "4173"}`;
  const proxy = createServer((incoming, outgoing) => {
    const api = incoming.url?.startsWith("/api/");
    const upstream = proxyRequest(new URL(incoming.url ?? "/", api ? coreOrigin : `http://127.0.0.1:${metroPort}`), {
      method: incoming.method,
      headers: { ...incoming.headers, host: api ? new URL(coreOrigin).host : `127.0.0.1:${metroPort}`,
        ...(api && incoming.headers.origin ? { origin: coreOrigin } : {}) },
    }, (response) => { outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing); });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end("Mobile test service unavailable"); });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy port");
  const origin = `http://127.0.0.1:${address.port}`;
  const mobile = spawn(process.execPath, ["node_modules/expo/bin/cli", "start", "--port", String(metroPort), "--offline"], {
    cwd: resolve(process.cwd(), "../mobile"),
    env: { ...process.env, NODE_ENV: "development", CI: "1", EXPO_PUBLIC_CORE_URL: origin }, stdio: "inherit",
  });
  let startupError: Error | undefined;
  mobile.on("error", (error) => { startupError = error; });
  const close = async () => {
    if (mobile.exitCode === null) {
      const stopped = new Promise<void>((resolve) => mobile.once("exit", () => resolve()));
      mobile.kill("SIGTERM"); await stopped;
    }
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  };
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (startupError) throw startupError;
      if (mobile.exitCode !== null) throw new Error(`Expo exited with code ${mobile.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${metroPort}/status`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return { origin, close };
      } catch { /* Waiting for the actual Metro process. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Expo did not start within 60 seconds");
  } catch (cause) { await close(); throw cause; }
}
