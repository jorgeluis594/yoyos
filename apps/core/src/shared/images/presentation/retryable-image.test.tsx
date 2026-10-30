// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { RetryableImage } from "@core/src/shared/images/presentation/retryable-image";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
  act(() => root.render(<RetryableImage url="https://img.test/a.png" alt="Foto" className="max-h-40" failedText="No cargó" retryText="Otra vez" />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("an image that fails to load says so and offers a retry that renders it again", () => {
  act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("[role='alert']")?.textContent).toContain("No cargó");
  act(() => container.querySelector<HTMLButtonElement>("[role='alert'] button")!.click());
  expect(container.querySelector("[role='alert']")).toBeNull();
  expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.test/a.png");
});
