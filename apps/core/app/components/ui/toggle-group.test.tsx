// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Mode() {
  const [mode, setMode] = useState("light");
  return (
    <ToggleGroup type="single" aria-label="Modo" value={mode} onValueChange={(value) => value && setMode(value)}>
      <ToggleGroupItem value="light">Claro</ToggleGroupItem>
      <ToggleGroupItem value="dark">Oscuro</ToggleGroupItem>
    </ToggleGroup>
  );
}

// Documents the contract that replaces the old `aria-pressed` segmented buttons.
test("single mode exposes the chosen option as a checked radio and never empties", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Mode />));
  const item = (text: string) => [...container.querySelectorAll("button")].find((button) => button.textContent === text)!;
  expect(item("Claro").getAttribute("role")).toBe("radio");
  expect(item("Claro").getAttribute("aria-checked")).toBe("true");
  await act(async () => item("Oscuro").click());
  expect(item("Oscuro").getAttribute("aria-checked")).toBe("true");
  await act(async () => item("Oscuro").click());
  expect(item("Oscuro").getAttribute("aria-checked")).toBe("true");
  root.unmount();
});
