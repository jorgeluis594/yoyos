import { expect, test, vi } from "vitest";
import type { Response } from "express";
import { sendOperationError } from "@core/src/features/products/presentation/api-errors";

test("a save whose reload cannot resolve a photo answers 503 SERVICE_UNAVAILABLE, not 404", () => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  sendOperationError({ status } as unknown as Response, { code: "IMAGE_NOT_FOUND" });
  expect(status).toHaveBeenCalledWith(503);
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }));
});
