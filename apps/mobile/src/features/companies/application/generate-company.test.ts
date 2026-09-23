import * as Crypto from "expo-crypto";
import { generateCompany } from "./generate-company";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "generated-id") }));

const randomUUID = Crypto.randomUUID as jest.Mock;

beforeEach(() => randomUUID.mockClear());

test("preserves supplied ID and name", () => {
  expect(generateCompany({ id: "company-1", name: "  Yoyos  " })).toEqual({
    success: true, data: { id: "company-1", name: "  Yoyos  " },
  });
  expect(randomUUID).not.toHaveBeenCalled();
});

test("generates an ID when missing", () => {
  expect(generateCompany({ name: "Yoyos" })).toEqual({
    success: true, data: { id: "generated-id", name: "Yoyos" },
  });
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

test.each([
  ["empty name", { name: "  " }],
  ["empty ID", { id: "  ", name: "Yoyos" }],
])("rejects %s without generating an ID", (_label, input) => {
  expect(generateCompany(input)).toMatchObject({ success: false, error: { code: "INVALID_COMPANY" } });
  expect(randomUUID).not.toHaveBeenCalled();
});
