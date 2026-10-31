// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { StoreBrandHeader } from "@core/src/features/store-appearance/presentation/store-brand-header";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("StoreBrandHeader", () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

  function mount(logoUrl: string | null) {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<StoreBrandHeader companyName="Lima Studio" logoUrl={logoUrl} />));
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
    const html = renderToStaticMarkup(<StoreBrandHeader companyName="Lima Studio" logoUrl="https://cdn.example/logo.png" />);
    expect(html).toContain('data-store-part="header-brand"');
    for (const [property, fallback] of [
      ["height", "2.5rem"], ["max-width", "10rem"], ["border-radius", "var(--radius-sm)"], ["border", "1px solid var(--border)"], ["box-shadow", "none"], ["padding", "0.25rem 0.5rem"],
    ]) expect(html, property).toMatch(new RegExp(`${property}:var\\(--store-logo-[a-z-]+,\\s*${fallback.replace(/[().]/g, "\\$&")}\\)`));
  });

  test("sets the store name in the theme's heading font and weight", () => {
    const html = renderToStaticMarkup(<StoreBrandHeader companyName="Lima Studio" logoUrl={null} />);
    expect(html).toContain("font-family:var(--store-font-heading, inherit)");
    expect(html).toContain("font-weight:var(--store-weight-heading, 600)");
    expect(html).not.toContain("font-semibold");
  });

  test("links the logo and the name together to the given path, and is plain without one", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StoreBrandHeader companyName="Lima Studio" logoUrl="https://cdn.example/logo.png" to="/" /></MemoryRouter>);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = doc.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/");
    expect(links[0].getAttribute("data-slot")).toBe("brand-link");
    expect(links[0].textContent).toBe("Lima Studio");
    expect(links[0].querySelector('[data-slot="brand-logo"]')).not.toBeNull();
    expect(renderToStaticMarkup(<StoreBrandHeader companyName="Lima Studio" logoUrl={null} />)).not.toContain("<a ");
  });

  test("the element the theme lays out holds the logo and the name directly, so a theme's logo direction reaches them with or without a link", () => {
    for (const to of [undefined, "/"]) {
      const html = renderToStaticMarkup(<MemoryRouter><StoreBrandHeader companyName="Lima Studio" logoUrl="https://cdn.example/logo.png" to={to} /></MemoryRouter>);
      const brand = new DOMParser().parseFromString(html, "text/html").querySelector('[data-store-part="header-brand"]')!;
      expect([...brand.children].map((child) => child.getAttribute("data-slot") ?? child.tagName), String(to)).toEqual(["brand-logo", "P"]);
      expect(brand.className).toContain("flex");
    }
  });

  test("the link is read once as the store name: the logo image has an empty alt", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StoreBrandHeader companyName="Lima Studio" logoUrl="https://cdn.example/logo.png" to="/" /></MemoryRouter>);
    const link = new DOMParser().parseFromString(html, "text/html").querySelector("a")!;
    expect(link.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(link.textContent).toBe("Lima Studio");
    expect(link.getAttribute("aria-label")).toBeNull();
  });
});
