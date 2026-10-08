import { requireOptionalNativeModule } from "expo";
import { probeWhatsAppBridge } from "@mobile/modules/whatsapp";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
const optionalModule = requireOptionalNativeModule as jest.Mock;

beforeEach(() => optionalModule.mockReset());

test("reports absent native module", async () => {
  optionalModule.mockReturnValue(null);
  await expect(probeWhatsAppBridge("{}"))
    .resolves.toMatchObject({ success: false, error: { code: "MODULE_UNAVAILABLE" } });
});

test("preserves callback value and error", async () => {
  optionalModule.mockReturnValue({ probe: jest.fn().mockResolvedValueOnce({ status: "ok", value: "{}" }).mockResolvedValueOnce({ status: "error", code: "NATIVE_CALL_FAILED" }) });
  await expect(probeWhatsAppBridge("{}"))
    .resolves.toEqual({ success: true, data: "{}" });
  await expect(probeWhatsAppBridge("{}", true))
    .resolves.toMatchObject({ success: false, error: { code: "NATIVE_CALL_FAILED" } });
});

test("rejects bad input and malformed native response", async () => {
  const probe = jest.fn().mockResolvedValue({ status: "ok" });
  optionalModule.mockReturnValue({ probe });
  await expect(probeWhatsAppBridge("bad json"))
    .resolves.toMatchObject({ success: false, error: { code: "INVALID_INPUT" } });
  expect(probe).not.toHaveBeenCalled();
  await expect(probeWhatsAppBridge("{}"))
    .resolves.toMatchObject({ success: false, error: { code: "INVALID_NATIVE_RESPONSE" } });
});
