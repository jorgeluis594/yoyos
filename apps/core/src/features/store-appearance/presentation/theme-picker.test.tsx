// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { StoreThemeId } from "@shared/store-themes";
import { ThemePicker } from "@core/src/features/store-appearance/presentation/theme-picker";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const descriptions: Record<StoreThemeId, string> = {
  classic: "Limpio y neutro", boutique: "Editorial y elegante", antojo: "Colorido y juguetón", suave: "Delicado y cálido", noche: "Oscuro y moderno",
};

describe("ThemePicker", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  function mount(value: StoreThemeId, onChange = vi.fn()) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<ThemePicker value={value} onChange={onChange} label="Temas disponibles" descriptions={descriptions} />));
    return { container, onChange, options: () => [...container.querySelectorAll<HTMLElement>('[role="radio"]')] };
  }

  test("lists the five themes in order with their sample and description", () => {
    const { container, options } = mount("classic");
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Temas disponibles");
    expect(options().map((option) => option.textContent)).toEqual([
      "ClásicoLimpio y neutro", "BoutiqueEditorial y elegante", "AntojoColorido y juguetón", "SuaveDelicado y cálido", "NocheOscuro y moderno",
    ]);
    for (const option of options()) expect(option.querySelector('[data-slot="theme-sample"]')?.getAttribute("aria-hidden")).toBe("true");
  });

  test("marks the selected theme and changes the draft when another is chosen", () => {
    const { options, onChange } = mount("boutique");
    expect(options().map((option) => option.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "false"]);
    expect(options()[1].querySelector("svg")).not.toBeNull();
    act(() => options()[4].click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("noche");
  });

  test("keeps the selection when the selected theme is chosen again", () => {
    const { options, onChange } = mount("antojo");
    act(() => options()[2].click());
    expect(onChange).not.toHaveBeenCalled();
    expect(options()[2].getAttribute("aria-checked")).toBe("true");
  });

  test("paints each sample with its own theme", () => {
    const { options } = mount("classic");
    const frames = options().map((option) => option.querySelector<HTMLElement>('[data-slot="theme-sample"]')!.style.backgroundColor);
    expect(new Set(frames).size).toBe(5);
  });
});
