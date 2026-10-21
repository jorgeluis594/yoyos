// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { ProductThumbnail } from "@core/src/features/checkout-appearance/presentation/product-thumbnail";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ProductThumbnail", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  function render(name: string, url: string | null) {
    act(() => root!.render(<ProductThumbnail name={name} url={url} />));
  }

  function mount(name: string, url: string | null) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<ProductThumbnail name={name} url={url} />));
    return container;
  }

  test("shows the product photo as a decorative image", () => {
    const container = mount("Polo básico", "https://cdn.example/polo.jpg");
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("https://cdn.example/polo.jpg");
    expect(image.getAttribute("alt")).toBe("");
    expect(container.textContent).toBe("");
  });

  test("shows the capitalized initial when the product has no photo", () => {
    const container = mount("taza blanca", null);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("T");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("T");
  });

  test("shows the initial when the photo fails to load", () => {
    const container = mount("Taza blanca", "https://cdn.example/deleted.jpg");
    act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("T");
  });

  test("tries again when the photo changes after a failure", () => {
    const container = mount("Taza blanca", "https://cdn.example/deleted.jpg");
    act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(container.querySelector("img")).toBeNull();
    render("Taza blanca", "https://cdn.example/new.jpg");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/new.jpg");
  });

  test("takes its size and shape from the theme variables", () => {
    const container = mount("Taza blanca", null);
    const style = container.firstElementChild!.getAttribute("style")!;
    for (const name of ["width", "radius", "border", "filter", "ratio"]) expect(style, name).toContain(`--checkout-thumb-${name}`);
  });
});
