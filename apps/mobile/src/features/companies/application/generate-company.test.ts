import * as Crypto from "expo-crypto";
import { generateCompany } from "./generate-company";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "generated-id") }));

const randomUUID = Crypto.randomUUID as jest.Mock;

beforeEach(() => randomUUID.mockClear());

test("preserves supplied ID, name and country", () => {
  expect(generateCompany({ id: "company-1", name: "  Yoyos  ", country: "PE" })).toEqual({
    success: true, data: { id: "company-1", name: "  Yoyos  ", country: "PE" },
  });
  expect(randomUUID).not.toHaveBeenCalled();
});

test("generates an ID when missing", () => {
  expect(generateCompany({ name: "Yoyos", country: "US" })).toEqual({
    success: true, data: { id: "generated-id", name: "Yoyos", country: "US" },
  });
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

test.each([
  ["empty name", { name: "  ", country: "PE" }],
  ["empty ID", { id: "  ", name: "Yoyos", country: "PE" }],
  ["missing country", { name: "Yoyos" }],
  ["unsupported country", { name: "Yoyos", country: "XX" }],
])("rejects %s without generating an ID", (_label, input) => {
  expect(generateCompany(input as Parameters<typeof generateCompany>[0])).toMatchObject({ success: false, error: { code: "INVALID_COMPANY" } });
  expect(randomUUID).not.toHaveBeenCalled();
});
