import { makeCopyCount } from "@mobile/features/printing/domain/printing";

test("copies must be positive safe integers", () => {
  for (const value of [1, 5, Number.MAX_SAFE_INTEGER]) expect(makeCopyCount(value).success).toBe(true);
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(makeCopyCount(value)).toMatchObject({ success: false, error: { code: "INVALID_COPIES" } });
  }
});
