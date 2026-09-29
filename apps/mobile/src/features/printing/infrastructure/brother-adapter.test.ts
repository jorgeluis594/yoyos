import { err, ok } from "@shared/functional";
import { brotherAdapter, parseBrotherSelection } from "@mobile/features/printing/infrastructure/brother-adapter";
import { productLabelFormat } from "@mobile/features/printing/domain/printing";

const mockDiscover = jest.fn();
const mockResolve = jest.fn();
const mockSend = jest.fn();
jest.mock("@mobile/modules/brother-printer", () => ({ discoverBrother: (...args: unknown[]) => mockDiscover(...args), resolveBrother: (...args: unknown[]) => mockResolve(...args), sendBrother: (...args: unknown[]) => mockSend(...args) }));

beforeEach(() => { mockDiscover.mockReset(); mockResolve.mockReset(); mockSend.mockReset(); });

test("offers only identified QL-810W devices without duplicates", async () => {
  mockDiscover.mockResolvedValue(ok([
    { model: "QL-810W", ip: "192.168.1.10", serial: "ABC" },
    { model: "QL-810W", ip: "192.168.1.11", serial: "ABC" },
    { model: "QL-820NWB", ip: "192.168.1.13", serial: "OTHER" },
  ]));
  const result = await brotherAdapter.discover();
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toHaveLength(1);
    expect(result.data[0].printer.id).toBe("serial:ABC");
    expect(parseBrotherSelection(result.data[0])?.lastKnownIp).toBe("192.168.1.11");
  }
});

test("reports a Brother printer that cannot be identified safely", async () => {
  mockDiscover.mockResolvedValue(ok([{ model: "QL-810W", ip: "192.168.1.12" }]));
  expect(await brotherAdapter.discover()).toMatchObject({ success: false, error: { code: "DISCOVERY_FAILED" } });
});

test("reconnects by serial after an IP change and refuses another device at the old IP", async () => {
  mockDiscover.mockResolvedValueOnce(ok([{ model: "QL-810W", ip: "192.168.1.10", serial: "ABC" }]));
  const discovered = await brotherAdapter.discover();
  if (!discovered.success) throw new Error("Expected discovery");
  const saved = discovered.data[0];
  mockResolve.mockResolvedValueOnce(ok({ model: "QL-810W", ip: "192.168.1.11", serial: "ABC" }));
  const resolved = await brotherAdapter.resolve(saved, productLabelFormat);
  expect(resolved).toMatchObject({ success: true, data: { profile: { widthPx: 696, heightPx: 271 } } });
  if (resolved.success) expect(parseBrotherSelection(resolved.data.selection)?.lastKnownIp).toBe("192.168.1.11");
  expect(mockResolve).toHaveBeenCalledWith({ model: "QL-810W", identityKind: "serial", identityValue: "ABC", lastKnownIp: "192.168.1.10" });
  mockResolve.mockResolvedValueOnce(ok({ model: "QL-810W", ip: "192.168.1.10", serial: "OTHER" }));
  expect(await brotherAdapter.resolve(saved, productLabelFormat)).toMatchObject({ success: false, error: { code: "PRINTER_IDENTITY_MISMATCH" } });
});

test("keeps native uncertainty when sending", async () => {
  mockDiscover.mockResolvedValue(ok([{ model: "QL-810W", ip: "192.168.1.10", serial: "ABC" }]));
  mockResolve.mockResolvedValue(ok({ model: "QL-810W", ip: "192.168.1.10", serial: "ABC" }));
  const discovered = await brotherAdapter.discover();
  if (!discovered.success) throw new Error("Expected discovery");
  const resolved = await brotherAdapter.resolve(discovered.data[0], productLabelFormat);
  if (!resolved.success) throw new Error("Expected resolution");
  mockSend.mockResolvedValue(err({ code: "COMMUNICATION_FAILED", message: "Disconnected", outcome: "unknown" }));
  expect(await brotherAdapter.send({ printer: resolved.data, document: { uri: "file:///label.png", widthPx: 696, heightPx: 271 }, copies: 2 as never })).toMatchObject({ success: false, error: { outcome: "unknown" } });
  expect(mockSend).toHaveBeenCalledWith({ model: "QL-810W", labelSize: "DK-1209", ip: "192.168.1.10", identityKind: "serial", identityValue: "ABC", uri: "file:///label.png", copies: 2 });
});
