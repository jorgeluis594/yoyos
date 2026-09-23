import type { Result } from "@yoyos/types";

const success: Result<number> = { success: true, data: 1 };
const uncoded: Result<number> = { success: false, error: { message: "Failed" } };
const absent: Result<number | null> = { success: true, data: null };
type Duplicate = { message: string; code: "DUPLICATE"; existingId: string };
const coded: Result<number, Duplicate> = {
  success: false,
  error: { message: "Already exists", code: "DUPLICATE", existingId: "1" },
};

function consume(result: Result<number, Duplicate>): number | string {
  if (result.success) {
    // @ts-expect-error A success has no error.
    result.error;
    return result.data;
  }
  // @ts-expect-error A failure has no data.
  result.data;
  return result.error.existingId;
}

// @ts-expect-error A successful result requires data.
const missingData: Result<number> = { success: true };
// @ts-expect-error An error requires a message, even without a code.
const missingMessage: Result<number> = { success: false, error: {} };
// @ts-expect-error A specialized error preserves its allowed codes.
const wrongCode: Result<number, Duplicate> = { success: false, error: { message: "Failed", code: "OTHER", existingId: "1" } };

void [success, uncoded, absent, coded, consume, missingData, missingMessage, wrongCode];
