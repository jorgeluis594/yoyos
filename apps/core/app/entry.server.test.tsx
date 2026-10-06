import { afterEach, expect, test, vi } from "vitest";
import type { EntryContext, RouterContextProvider } from "react-router";
import handleRequest from "@core/app/entry.server";

const rendering = vi.hoisted(() => ({ getInstance: vi.fn(), render: vi.fn() }));
vi.mock("@core/app/middleware/i18next", () => ({ getInstance: rendering.getInstance }));
vi.mock("react-dom/server", () => ({ renderToPipeableStream: rendering.render }));

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

test.each(["context", "render"])("a synchronous %s failure leaves no abort timer", async (stage) => {
  vi.useFakeTimers();
  const failure = new Error("Rendering unavailable");
  const fail = () => { throw failure; };
  if (stage === "context") rendering.getInstance.mockImplementation(fail);
  else rendering.render.mockImplementation(fail);
  await expect(handleRequest(new Request("http://localhost/unknown"), 404, new Headers(),
    {} as EntryContext, {} as RouterContextProvider)).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});

test("a shell failure clears the pending abort timer", async () => {
  vi.useFakeTimers();
  const failure = new Error("Shell unavailable");
  const abort = vi.fn();
  rendering.render.mockImplementation((_children, options) => {
    queueMicrotask(() => options.onShellError(failure));
    return { pipe: vi.fn(), abort };
  });
  await expect(handleRequest(new Request("http://localhost/unknown"), 500, new Headers(),
    {} as EntryContext, {} as RouterContextProvider)).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
  expect(abort).not.toHaveBeenCalled();
});
