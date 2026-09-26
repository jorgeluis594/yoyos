import { spawn, type ChildProcess } from "node:child_process";
import { prisma, systemPrisma, withTenantIsolation } from "@core/src/shared/infrastructure/persistance";

let server: ChildProcess;
const companyId = "6b6c7217-c321-4f37-8923-05f4a2549f9c";

export async function setup() {
  await withTenantIsolation(companyId, async () => await prisma.company.upsert({ where: { id: companyId }, create: { id: companyId, name: "WhatsApp e2e", country: "PE" }, update: {} }));
  const connectedAt = "2026-01-01T00:00:00.000Z";
  server = spawn("node", ["--import", "tsx", "src/server.ts"], { env: {
    ...process.env, PORT: "4173", WHATSAPP_CONNECTIONS_JSON: JSON.stringify([{ companyId, phoneNumberId: "e2e-phone", businessAccountId: "e2e-waba", connectedAt, accessToken: "e2e-only-token" }]),
    WHATSAPP_APP_SECRET: "e2e-app-secret", WHATSAPP_VERIFY_TOKEN: "e2e-verify-token",
    R2_ENDPOINT: process.env.R2_ENDPOINT ?? "http://127.0.0.1:9000",
    R2_BUCKET: process.env.R2_BUCKET ?? "test-images",
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "test",
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "test",
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL ?? "http://127.0.0.1:4173/test-images",
  }, stdio: "inherit" });
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

export async function teardown() {
  server?.kill();
  if (server && server.exitCode === null) await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  await withTenantIsolation(companyId, async () => {
    await prisma.chatMessage.deleteMany({ where: { companyId } });
    await prisma.chat.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
  await systemPrisma.$disconnect();
}
