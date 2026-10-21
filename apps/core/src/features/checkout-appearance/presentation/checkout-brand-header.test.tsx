// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { CheckoutBrandHeader } from "@core/src/features/checkout-appearance/presentation/checkout-brand-header";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("CheckoutBrandHeader", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  function mount(logoUrl: string | null) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<CheckoutBrandHeader companyName="Lima Studio" logoUrl={logoUrl} />));
    return container;
  }

  test("shows the whole logo on a white plate next to the company name", () => {
    const container = mount("https://cdn.example/logo.png");
    const image = container.querySelector("img")!;
    const plate = container.querySelector<HTMLElement>('[data-slot="brand-logo"]')!;
    expect(image.getAttribute("src")).toBe("https://cdn.example/logo.png");
    expect(image.getAttribute("alt")).toBe("");
    expect(image.className).toContain("object-contain");
    expect(plate.className).toContain("bg-white");
    expect(plate.contains(image)).toBe(true);
    expect(container.textContent).toBe("Lima Studio");
  });

  test("shows only the company name when there is no logo", () => {
    const container = mount(null);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Lima Studio");
  });

  test("hides the logo and keeps the name when the image fails to load", () => {
    const container = mount("https://cdn.example/broken.png");
    act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-slot="brand-logo"]')).toBeNull();
    expect(container.textContent).toBe("Lima Studio");
  });

  test("reads the plate from the theme variables and falls back to the default Yoyos look", () => {
    const html = renderToStaticMarkup(<CheckoutBrandHeader companyName="Lima Studio" logoUrl="https://cdn.example/logo.png" />);
    expect(html).toContain('data-checkout-part="header-brand"');
    for (const [property, fallback] of [
      ["height", "2.5rem"], ["border-radius", "var(--radius-sm)"], ["border", "1px solid var(--border)"], ["box-shadow", "none"], ["padding", "0.25rem 0.5rem"],
    ]) expect(html, property).toMatch(new RegExp(`${property}:var\\(--checkout-logo-[a-z]+,\\s*${fallback.replace(/[().]/g, "\\$&")}\\)`));
  });
});
