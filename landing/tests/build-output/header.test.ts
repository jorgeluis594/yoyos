import { describe, expect, test } from "vitest";
import { pages, readPage } from "./html";

const whatsapp = "https://wa.me/51912345678?text=Hola%2C%20quiero%20una%20demo%20de%20Yoyos";

describe("header", () => {
  test("shows the logo, the five anchors, the WhatsApp link and the call link with its aria-label", () => {
    const header = readPage("minimal", "index.html").querySelector("header.site-header");
    expect(header?.querySelector('a[href="/"] img')?.getAttribute("alt")).toBe("Yoyos");
    expect(header?.querySelectorAll("nav a").map((link) => [link.text, link.getAttribute("href")])).toEqual([
      ["Cómo funciona", "#como-funciona"],
      ["Funciones", "#funciones"],
      ["Envíos y pagos", "#integraciones"],
      ["Precio", "#precio"],
      ["Preguntas", "#preguntas"],
    ]);
    const chat = header?.querySelector('[data-event="whatsapp_click"]');
    expect(chat?.getAttribute("href")).toBe(whatsapp);
    expect(chat?.text.trim()).toBe("Escríbenos por WhatsApp");
    const call = header?.querySelector('[data-event="call_click"]');
    expect(call?.getAttribute("href")).toBe("tel:+51912345678");
    expect(call?.getAttribute("aria-label")).toBe("Llamar a Yoyos al +51 912 345 678");
  });

  test("points the anchors at the home from the other pages", () => {
    const links = readPage("minimal", "privacidad.html").querySelectorAll("header nav a");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/#como-funciona", "/#funciones", "/#integraciones", "/#precio", "/#preguntas"]);
  });

  test("hides Ingresar with an empty login URL and links it in header and footer when configured", () => {
    for (const file of pages) {
      expect(readPage("minimal", file).querySelectorAll("a").filter((link) => link.text.trim() === "Ingresar")).toHaveLength(0);
    }
    const page = readPage("full", "index.html");
    expect(page.querySelectorAll("header a").filter((link) => link.getAttribute("href") === "https://app.example.test/login")).toHaveLength(1);
    expect(page.querySelectorAll("footer a").filter((link) => link.getAttribute("href") === "https://app.example.test/login")).toHaveLength(1);
  });

  test("starts every page with the skip link to the main content", () => {
    for (const file of pages) {
      const page = readPage("minimal", file);
      expect(page.querySelector("body a")?.getAttribute("href")).toBe("#contenido");
      expect(page.querySelector("main")?.getAttribute("id")).toBe("contenido");
    }
  });
});
