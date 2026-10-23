import { request as httpRequest } from "node:http";
import { afterAll, expect, test, vi } from "vitest";
import { app } from "@core/src/app";
import { prisma, systemPrisma } from "@core/src/shared/infrastructure/persistance";

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const bound = server.address();
if (!bound || typeof bound === "string") throw new Error("App server did not bind");
const port = bound.port;
afterAll(() => { server.close(); });

/** Plain `http` so the test chooses the `Host` header, which `fetch` may override. */
function get(path: string, host: string, method = "GET") {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("any /api path on a store host answers 404 without reaching auth or routers", async () => {
  for (const [path, method] of [["/api/me", "GET"], ["/api/auth/get-session", "GET"], ["/api/catalog/settings", "GET"], ["/api/products", "POST"], ["/api", "GET"]])
    for (const host of ["fantasio.localhost:3000", "a.b.localhost:3000", "no-existe.localhost"]) {
      const response = await get(path, host, method);
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({ code: "NOT_FOUND", error: "Not found" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  expect((await get("/api/me", "localhost:3000")).status).toBe(401);
  expect((await get("/api/me", "127.0.0.1")).status).toBe(401);
});

test("robots.txt and scanner paths on a store host answer without a database query", async () => {
  const queries = [vi.spyOn(prisma, "$queryRaw"), vi.spyOn(systemPrisma, "$queryRaw"), vi.spyOn(prisma, "$transaction")];
  const robots = await get("/robots.txt", "fantasio.localhost:3000");
  expect(robots).toMatchObject({ status: 200, body: "User-agent: *\nDisallow: /\n", headers: { "cache-control": "public, max-age=86400" } });
  expect(robots.headers["content-type"]).toContain("text/plain");
  for (const path of ["/wp-login.php", "/xmlrpc.php", "/.env", "/.git/config", "/wp-admin/setup-config.php", "/phpinfo.php", "/WP-login.PHP"])
    expect(await get(path, "fantasio.localhost:3000")).toMatchObject({ status: 404, body: "Not found" });
  for (const query of queries) expect(query).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
