// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { FileUpload, FileUploadTrigger } from "@/components/ui/file-upload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, root, input: container.querySelector<HTMLInputElement>('[data-slot="file-upload-input"]')! };
}

test("the trigger opens the hidden input and hands over the chosen file", async () => {
  const onFileSelect = vi.fn();
  const { container, root, input } = await render(<FileUpload accept="image/png" onFileSelect={onFileSelect}><FileUploadTrigger>Subir</FileUploadTrigger></FileUpload>);
  const click = vi.spyOn(input, "click");
  await act(async () => container.querySelector("button")!.click());
  expect(click).toHaveBeenCalled();

  const file = new File(["x"], "logo.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(onFileSelect).toHaveBeenCalledWith(file);
  expect(input.accept).toBe("image/png");
  root.unmount();
});

test("disabling the upload disables its input and trigger", async () => {
  const { container, root, input } = await render(<FileUpload disabled onFileSelect={() => undefined}><FileUploadTrigger>Subir</FileUploadTrigger></FileUpload>);
  expect(input.disabled).toBe(true);
  expect(container.querySelector("button")!.disabled).toBe(true);
  root.unmount();
});
