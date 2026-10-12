import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveRecoveryBufferBytes, resolveWhatsAppOptions } from "./whatsapp-options";
import { createWhatsAppComposition } from "./create-whatsapp-composition";
import { ok } from "@shared/functional";
import type { WhatsAppClient } from "@mobile/modules/whatsapp/types";

const MIB = 1024 * 1024;

// UT-CFG-01
test("UT-CFG-01 resolves 10 MiB of recovery and 50 MiB of images when nothing is configured", () => {
  expect(resolveWhatsAppOptions(undefined)).toEqual({ success: true, data: { maxRecoveryBufferBytes: 10 * MIB, maxImageStorageBytes: 50 * MIB } });
});

// UT-CFG-02
test("UT-CFG-02 converts a positive integer of MiB into bytes", () => {
  expect(resolveRecoveryBufferBytes("1")).toEqual({ success: true, data: MIB });
  expect(resolveRecoveryBufferBytes("64")).toEqual({ success: true, data: 64 * MIB });
  const largest = Math.floor(Number.MAX_SAFE_INTEGER / MIB);
  expect(resolveRecoveryBufferBytes(String(largest))).toEqual({ success: true, data: largest * MIB });
});

test.each([
  ["empty", ""], ["blank", " "], ["zero", "0"], ["negative", "-1"], ["fraction", "1.5"], ["exponent", "1e3"], ["hexadecimal", "0x10"],
  ["text", "ten"], ["padded", " 10"], ["trailing", "10 "], ["signed", "+10"], ["leading zero", "010"], ["separator", "1_000"],
  ["not a safe byte count", String(Math.floor(Number.MAX_SAFE_INTEGER / MIB) + 1)], ["huge", "9".repeat(40)],
])("UT-CFG-02 fails on a %s value instead of using the default", (_name, raw) => {
  const result = resolveWhatsAppOptions(raw);
  expect(result.success).toBe(false);
  expect(!result.success && result.error.code).toBe("INVALID_WHATSAPP_RECOVERY_BUFFER_MIB");
});

// IT-CFG-01: the composition hands the module the effective bytes; an invalid setting never reaches it.
describe("IT-CFG-01 composition", () => {
  const client = () => {
    const initialize = jest.fn(async () => ok(undefined));
    return { initialize, client: { initialize } as unknown as WhatsAppClient };
  };

  test("passes the default budgets explicitly", async () => {
    const { initialize, client: fake } = client();
    expect((await createWhatsAppComposition(fake, undefined).initialize()).success).toBe(true);
    expect(initialize).toHaveBeenCalledWith({ maxRecoveryBufferBytes: 10 * MIB, maxImageStorageBytes: 50 * MIB });
  });

  test("passes the configured recovery buffer", async () => {
    const { initialize, client: fake } = client();
    await createWhatsAppComposition(fake, "32").initialize();
    expect(initialize).toHaveBeenCalledWith({ maxRecoveryBufferBytes: 32 * MIB, maxImageStorageBytes: 50 * MIB });
  });

  test("an invalid value fails without touching the module and without a fallback", async () => {
    const { initialize, client: fake } = client();
    const result = await createWhatsAppComposition(fake, "").initialize();
    expect(result.success).toBe(false);
    expect(initialize).not.toHaveBeenCalled();
  });
});

// Go and the native layers never read `.env` or the bundle variable: the budget arrives as bytes.
test("IT-CFG-01 native and Go sources do not read the environment variable", () => {
  const root = join(__dirname, "../../modules/whatsapp");
  const offenders: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (["node_modules", ".generated", "Pods", "build"].includes(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) { visit(path); continue; }
      if (!/\.(go|kt|swift|java|m|h)$/.test(entry)) continue;
      if (/EXPO_PUBLIC|getenv|Getenv|ProcessInfo[^\n]*environment|System\.getenv|dotenv|["']\.env/.test(readFileSync(path, "utf8")) && !/_test\.go$|Tests?\.(kt|swift)$/.test(entry)) offenders.push(path);
    }
  };
  visit(root);
  expect(offenders).toEqual([]);
});
