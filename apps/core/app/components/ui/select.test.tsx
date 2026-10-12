// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = [{ value: "PE", label: "Perú" }, { value: "CO", label: "Colombia" }];

function Country(props: Partial<React.ComponentProps<typeof Select>>) {
  return (
    <Select name="country" items={items} {...props}>
      <SelectTrigger id="country"><SelectValue placeholder="Selecciona" /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

test("posts its value through a hidden input named like the field and shows the label", () => {
  const html = renderToStaticMarkup(<Country defaultValue="CO" />);
  expect(html).toMatch(/<input[^>]*name="country"[^>]*value="CO"|<input[^>]*value="CO"[^>]*name="country"/);
  expect(html).toContain("Colombia");
});

// Replacement for `selectOptions` in jsdom tests: open the trigger, then click the option by its text.
test("chooses an option by clicking the trigger and the option", async () => {
  const onValueChange = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => root.render(<Country onValueChange={onValueChange} />));
  await act(async () => container.querySelector<HTMLElement>('[data-slot="select"]')!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === "Perú")!;
  await act(async () => option.click());
  expect(onValueChange.mock.calls[0]?.[0]).toBe("PE");
  root.unmount();
  container.remove();
});
