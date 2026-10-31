import { expect, test } from "vitest";
import { signedRequestFailure } from "@core/src/features/assistants/infrastructure/signed-request";

const now = new Date("2026-10-30T12:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

test("tells an expired request from a tampered one", () => {
  const past = seconds(new Date(now.getTime() - 1000));
  const future = seconds(new Date(now.getTime() + 60_000));
  expect(signedRequestFailure(`client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&exp=${past}&sig=abc`, now)).toBe("REQUEST_EXPIRED");
  // A signature that does not match before the deadline can only be tampering.
  expect(signedRequestFailure(`client_id=c&exp=${future}&sig=abc`, now)).toBe("REQUEST_INVALID");
});

test("treats anything that is not a well-formed signed query as invalid", () => {
  for (const query of ["", "garbage", "client_id=c&sig=abc", "client_id=c&exp=soon&sig=abc", `exp=${seconds(now) - 5}&sig=abc`, `client_id=c&exp=${seconds(now) - 5}`]) {
    expect(signedRequestFailure(query, now)).toBe("REQUEST_INVALID");
  }
});
