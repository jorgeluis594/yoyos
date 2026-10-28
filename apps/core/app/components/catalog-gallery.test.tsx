// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { storeThemeIds } from "@shared/store-themes";
import { CatalogGallery, lightboxColors } from "@core/app/components/catalog-gallery";
import { CatalogShell } from "@core/app/components/catalog-sections";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const urls = (count: number) => Array.from({ length: count }, (_, index) => `https://img.test/photo-${index + 1}.jpg`);
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

async function mount(photoUrls: string[], theme: (typeof storeThemeIds)[number] = "classic") {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root!.render(<CatalogShell appearance={{ logoUrl: null, theme }} storeName="Moda Lucía">
    <CatalogGallery name="Polo básico" photoUrls={photoUrls} />
  </CatalogShell>));
}
const part = (name: string) => container.querySelector<HTMLElement>(`[data-store-part="${name}"]`);
const parts = (name: string) => [...container.querySelectorAll<HTMLElement>(`[data-store-part="${name}"]`)];
const thumbnails = () => parts("catalog-gallery-thumbnail");
const largeButton = () => container.querySelector<HTMLButtonElement>('[data-store-part="catalog-gallery-large"] button:not([tabindex="-1"])')!;
const lightbox = () => part("catalog-lightbox");
const named = (name: string) => [...(lightbox() ?? container).querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === name);
const indicator = () => lightbox()?.querySelector('[role="status"]')?.textContent;
// Radix hands focus back in a timeout once the dialog unmounts, so every action waits one task.
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).focus(); (element as HTMLElement).click(); }); await settle(); };
const key = async (target: Element, name: string, init: KeyboardEventInit = {}) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })); });
  await settle();
};
const pointer = (target: Element, type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", x: number, y: number) =>
  act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });
const scrollTo = (track: HTMLElement, index: number, width = 300) => act(async () => {
  Object.defineProperty(track, "clientWidth", { configurable: true, value: width });
  track.scrollLeft = index * width;
  track.dispatchEvent(new Event("scroll"));
});

describe("catalog gallery", () => {
  test("with two or more photos the gallery shows the primary large and every photo, primary included, as a thumbnail in saved order", async () => {
    const photoUrls = urls(3);
    await mount(photoUrls);
    // The primary frame fires load, which releases the thumbnails.
    await act(async () => { part("catalog-product-photo")!.querySelector("img")!.dispatchEvent(new Event("load")); });
    expect(thumbnails().map((thumb) => thumb.querySelector("img")!.getAttribute("src"))).toEqual(photoUrls);
    expect(thumbnails().map((thumb) => thumb.getAttribute("aria-label"))).toEqual(["Ver foto 1 de 3", "Ver foto 2 de 3", "Ver foto 3 de 3"]);
    expect(thumbnails().map((thumb) => thumb.getAttribute("aria-current"))).toEqual(["true", null, null]);
    expect(largeButton().getAttribute("aria-label")).toBe("Ver foto 1 de 3");
    expect(largeButton().querySelector("img")!.getAttribute("src")).toBe(photoUrls[0]);
    expect(lightbox()).toBeNull();
  });

  test("clicking a thumbnail opens the full-screen lightbox on that photo", async () => {
    await mount(urls(3));
    await click(thumbnails()[1]);
    expect(lightbox()).not.toBeNull();
    expect(indicator()).toBe("2 de 3");
    expect(document.activeElement && lightbox()!.contains(document.activeElement)).toBe(true);
  });

  test("clicking the large photo, or pressing Enter on it, opens the lightbox on it", async () => {
    await mount(urls(3));
    await click(largeButton());
    expect(indicator()).toBe("1 de 3");
    await click(named("Cerrar")!);
    expect(lightbox()).toBeNull();
    // Enter on a native button activates it through its click.
    expect(largeButton().tagName).toBe("BUTTON");
    expect(largeButton().type).toBe("button");
    await click(largeButton());
    expect(lightbox()).not.toBeNull();
  });

  test("scrolling the page track to the third photo moves aria-current to its thumbnail and the large photo opens the lightbox on it", async () => {
    await mount(urls(3));
    await scrollTo(part("catalog-gallery-track")!, 2);
    expect(thumbnails().map((thumb) => thumb.getAttribute("aria-current"))).toEqual([null, null, "true"]);
    expect(largeButton().getAttribute("aria-label")).toBe("Ver foto 3 de 3");
    await click(largeButton());
    expect(indicator()).toBe("3 de 3");
  });

  test("the lightbox content covers the whole viewport and fits the photo without cropping", async () => {
    await mount(urls(3));
    await click(thumbnails()[0]);
    const content = lightbox()!;
    expect(content.style.width).toBe("100dvw");
    expect(content.style.height).toBe("100dvh");
    expect(content.style.overscrollBehavior).toBe("contain");
    const photos = [...content.querySelectorAll("img")];
    expect(photos).toHaveLength(3);
    for (const photo of photos) {
      expect(photo.className).toContain("object-contain");
      expect(photo.className).not.toContain("object-cover");
    }
  });

  test("the lightbox moves with arrow keys and buttons and announces 2 de 5", async () => {
    await mount(urls(5));
    await click(thumbnails()[1]);
    expect(indicator()).toBe("2 de 5");
    expect(lightbox()!.querySelector('[role="status"]')!.getAttribute("aria-live")).toBe("polite");
    await key(document.activeElement!, "ArrowRight");
    expect(indicator()).toBe("3 de 5");
    await key(document.activeElement!, "ArrowLeft");
    expect(indicator()).toBe("2 de 5");
    await click(named("Foto siguiente")!);
    expect(indicator()).toBe("3 de 5");
    await click(named("Foto anterior")!);
    await click(named("Foto anterior")!);
    expect(indicator()).toBe("1 de 5");
    await key(document.activeElement!, "ArrowLeft");
    expect(indicator()).toBe("1 de 5");
  });

  test("the lightbox traps focus, closes with Esc and with Cerrar, and returns focus to the opener", async () => {
    await mount(urls(3));
    const outside = document.body.appendChild(document.createElement("button"));
    const opener = thumbnails()[2];
    await click(opener);
    expect(lightbox()!.getAttribute("role")).toBe("dialog");
    expect(lightbox()!.getAttribute("aria-labelledby")).not.toBeNull();
    expect(document.getElementById(lightbox()!.getAttribute("aria-labelledby")!)!.textContent).toBe("Fotos de Polo básico");
    await act(async () => { outside.focus(); });
    expect(lightbox()!.contains(document.activeElement)).toBe(true);
    const tabbable = [...lightbox()!.querySelectorAll<HTMLElement>("button")];
    await act(async () => { tabbable.at(-1)!.focus(); });
    await key(tabbable.at(-1)!, "Tab");
    expect(lightbox()!.contains(document.activeElement)).toBe(true);
    await key(document.activeElement!, "Escape");
    expect(lightbox()).toBeNull();
    expect(document.activeElement).toBe(opener);
    await click(largeButton());
    await click(named("Cerrar")!);
    expect(lightbox()).toBeNull();
    expect(document.activeElement).toBe(largeButton());
    outside.remove();
  });

  test("Foto siguiente and Foto anterior keep focus inside the dialog at the ends and the arrow keys keep working", async () => {
    await mount(urls(3));
    await click(thumbnails()[1]);
    const next = named("Foto siguiente") as HTMLButtonElement;
    await click(next);
    expect(indicator()).toBe("3 de 3");
    // At the last photo the button stays enabled and focused; a disabled button would drop focus to body.
    expect(next.disabled).toBe(false);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(next);
    await click(next);
    expect(indicator()).toBe("3 de 3");
    await key(document.activeElement!, "ArrowLeft");
    expect(indicator()).toBe("2 de 3");
    const previous = named("Foto anterior") as HTMLButtonElement;
    await click(previous);
    await click(previous);
    expect(indicator()).toBe("1 de 3");
    expect(previous.disabled).toBe(false);
    expect(document.activeElement).toBe(previous);
    await key(document.activeElement!, "ArrowRight");
    expect(indicator()).toBe("2 de 3");
  });

  test("closing a lightbox opened from the large photo returns focus to the large photo now shown", async () => {
    await mount(urls(3));
    await click(largeButton());
    await key(document.activeElement!, "ArrowRight");
    await key(document.activeElement!, "ArrowRight");
    await key(document.activeElement!, "Escape");
    expect(lightbox()).toBeNull();
    expect(thumbnails().map((thumb) => thumb.getAttribute("aria-current"))).toEqual([null, null, "true"]);
    expect(largeButton().getAttribute("aria-label")).toBe("Ver foto 3 de 3");
    expect(document.activeElement).toBe(largeButton());
  });

  test("the page track keeps vertical scrolling over the large photo and the lightbox track pans horizontally only", async () => {
    await mount(urls(3));
    expect(part("catalog-gallery-track")!.style.touchAction).toBe("");
    await click(thumbnails()[0]);
    expect(part("catalog-lightbox-track")!.style.touchAction).toBe("pan-x");
  });

  test("a click on the scrim around the photo closes the lightbox and a click on the photo does not", async () => {
    await mount(urls(3));
    await click(thumbnails()[0]);
    await click(lightbox()!.querySelector("img")!);
    expect(lightbox()).not.toBeNull();
    await click(lightbox()!.querySelector('[data-store-part="catalog-lightbox-slide"]')!);
    expect(lightbox()).toBeNull();
  });

  test("a pointer drag down over the threshold closes the lightbox", async () => {
    await mount(urls(3));
    await click(thumbnails()[0]);
    const track = part("catalog-lightbox-track")!;
    await pointer(track, "pointerdown", 100, 100);
    await pointer(track, "pointermove", 104, 150);
    await pointer(track, "pointerup", 104, 150);
    expect(lightbox()).not.toBeNull();
    await pointer(track, "pointerdown", 100, 100);
    await pointer(track, "pointermove", 104, 220);
    await pointer(track, "pointerup", 104, 220);
    expect(lightbox()).toBeNull();
  });

  test("the lightbox track pans horizontally only and a cancelled pointer drag does not close it", async () => {
    await mount(urls(3));
    await click(thumbnails()[0]);
    const track = part("catalog-lightbox-track")!;
    expect(track.style.touchAction).toBe("pan-x");
    expect(track.style.overscrollBehavior).toBe("contain");
    await pointer(track, "pointerdown", 100, 100);
    await pointer(track, "pointermove", 100, 400);
    await pointer(track, "pointercancel", 100, 400);
    await pointer(track, "pointerup", 100, 400);
    expect(lightbox()).not.toBeNull();
    // A mostly horizontal drag is a swipe between photos, never a close.
    await pointer(track, "pointerdown", 100, 100);
    await pointer(track, "pointermove", 400, 200);
    await pointer(track, "pointerup", 400, 200);
    expect(lightbox()).not.toBeNull();
  });

  test("a product with one photo shows only the large photo as today, without a thumbnail row or swipe", async () => {
    const photoUrls = urls(1);
    await mount(photoUrls);
    expect(thumbnails()).toHaveLength(0);
    expect(part("catalog-gallery-track")).toBeNull();
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(photoUrls);
    expect(largeButton().getAttribute("aria-label")).toBe("Ver foto de Polo básico");
    const frame = part("catalog-product-photo")!;
    expect(frame.className).toContain("aspect-square");
    expect(frame.querySelector("img")!.className).toContain("object-cover");
  });

  test("a product with one photo opens the lightbox without navigation or indicator", async () => {
    await mount(urls(1));
    await click(largeButton());
    expect(lightbox()).not.toBeNull();
    expect(named("Foto anterior")).toBeUndefined();
    expect(named("Foto siguiente")).toBeUndefined();
    expect(lightbox()!.querySelector('[role="status"]')).toBeNull();
    expect(part("catalog-lightbox-track")!.style.touchAction).toBe("none");
    await key(document.activeElement!, "ArrowRight");
    expect(lightbox()).not.toBeNull();
    await pointer(part("catalog-lightbox-track")!, "pointerdown", 100, 100);
    await pointer(part("catalog-lightbox-track")!, "pointerup", 100, 260);
    expect(lightbox()).toBeNull();
  });

  test("a product without photos shows the neutral block and no lightbox", async () => {
    await mount([]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(part("catalog-product-photo")!.textContent).toBe("P");
    expect(lightbox()).toBeNull();
  });

  test("the gallery and lightbox apply no photo filter in any of the five themes", async () => {
    const filtering = /filter|grayscale|sepia|saturate|brightness|contrast-|blur|opacity|mix-blend/;
    for (const theme of storeThemeIds) {
      await mount(urls(3), theme);
      await click(thumbnails()[1]);
      const scope = container.querySelector('[data-store-theme]')!;
      expect(scope.getAttribute("data-store-theme-id")).toBe(theme);
      const nodes = [...parts("catalog-product-photo"), ...thumbnails(), ...container.querySelectorAll("[data-store-part^='catalog-gallery'] *, [data-store-part^='catalog-lightbox'] *, [data-store-part^='catalog-lightbox']")];
      expect(nodes.length).toBeGreaterThan(10);
      for (const node of nodes) {
        expect(node.getAttribute("class") ?? "", `${theme} ${node.tagName}`).not.toMatch(filtering);
        expect((node as HTMLElement).style.filter, theme).toBe("");
        expect(node.getAttribute("style") ?? "", theme).not.toMatch(/store-thumb-filter/);
      }
      act(() => root!.unmount());
      container.remove();
    }
  });

  test("lightbox scrim and controls meet the catalog contrast floor", () => {
    const channel = (hex: string, start: number) => {
      const value = parseInt(hex.slice(start, start + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const contrast = (a: string, b: string) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
    const { scrim, text, control, controlText, focus } = lightboxColors;
    expect(contrast(text, scrim), "indicator on scrim").toBeGreaterThanOrEqual(4.5);
    expect(contrast(controlText, control), "icon on control").toBeGreaterThanOrEqual(4.5);
    expect(contrast(control, scrim), "control boundary on scrim").toBeGreaterThanOrEqual(3);
    expect(contrast(focus, scrim), "focus ring on scrim").toBeGreaterThanOrEqual(3);
  });

  test("thumbnails are requested only after the primary photo has loaded or failed to load", async () => {
    const photoUrls = urls(3);
    await mount(photoUrls);
    const sources = () => thumbnails().map((thumb) => thumb.querySelector("img")?.getAttribute("src") ?? null);
    const primary = part("catalog-product-photo")!.querySelector("img")!;
    expect(primary.getAttribute("loading")).toBe("eager");
    expect(primary.getAttribute("fetchpriority")).toBe("high");
    expect(sources()).toEqual([null, null, null]);
    await act(async () => { primary.dispatchEvent(new Event("load")); });
    expect(sources()).toEqual(photoUrls);
    act(() => root!.unmount());
    container.remove();

    await mount(photoUrls);
    await act(async () => { part("catalog-product-photo")!.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(sources()).toEqual(photoUrls);
    // A broken primary shows the neutral block and never hides the other photos.
    expect(part("catalog-product-photo")!.textContent).toBe("P");
    expect(thumbnails()).toHaveLength(3);
  });

  test("slides other than the visible one load lazily in the page track and in the lightbox", async () => {
    await mount(urls(3));
    const slides = () => [...container.querySelectorAll<HTMLImageElement>('[data-store-part="catalog-gallery-track"] img')];
    expect(slides().map((img) => img.getAttribute("loading"))).toEqual(["eager", "lazy", "lazy"]);
    await click(thumbnails()[1]);
    const shown = [...lightbox()!.querySelectorAll("img")].map((img) => img.getAttribute("loading"));
    expect(shown).toEqual(["lazy", "eager", "lazy"]);
  });
});
