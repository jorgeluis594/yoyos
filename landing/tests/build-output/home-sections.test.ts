import type { HTMLElement } from "node-html-parser";
import { describe, expect, test } from "vitest";
import { headingLevels, readPage } from "./html";

const text = (node: HTMLElement | null | undefined): string => node?.text.replace(/\s+/g, " ").trim() ?? "";

const home = (variant: "minimal" | "full") => readPage(variant, "index.html");

describe("hero", () => {
  test("shows the H1, the lead, the three step labels, the price, the WhatsApp CTA and the call link literally", () => {
    const hero = home("full").querySelector("#inicio");
    expect(text(hero?.querySelector("h1"))).toBe("Del chat al paquete, sin copiar a mano.");
    expect(text(hero?.querySelector(".lead"))).toBe(
      "Para vendedores de TikTok LIVE: tu cliente te envía la foto por WhatsApp y Yoyos arma el pedido, con la entrega y el pago en un link.",
    );
    expect(hero?.querySelectorAll("ol.flow > li").map(text)).toEqual(["Foto por WhatsApp", "Yoyos arma el pedido", "Link de entrega y pago"]);
    expect(text(hero?.querySelector(".offer"))).toBe("S/ 50 al mes + IGV Sin comisión por venta.");
    const chat = hero?.querySelector('[data-event="whatsapp_click"]');
    expect(text(chat)).toBe("Escríbenos por WhatsApp");
    expect(chat?.getAttribute("data-location")).toBe("hero");
    expect(chat?.getAttribute("href")).toContain("https://wa.me/51912345678");
    const call = hero?.querySelector('[data-event="call_click"]');
    expect(text(call)).toBe("¿Prefieres hablar? Llámanos");
    expect(call?.getAttribute("data-location")).toBe("hero");
    expect(call?.getAttribute("href")).toBe("tel:+51912345678");
    expect(hero?.querySelectorAll("svg").every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  test("shows «Agenda una demo» to #demo only when the demo form is enabled", () => {
    const demoLinks = (variant: "minimal" | "full") =>
      home(variant).querySelectorAll("#inicio a").filter((link) => text(link) === "Agenda una demo");
    expect(demoLinks("minimal")).toHaveLength(0);
    const [demo, ...rest] = demoLinks("full");
    expect(rest).toHaveLength(0);
    expect(demo?.getAttribute("href")).toBe("#demo");
    expect(demo?.getAttribute("data-event")).toBe("demo_form_open");
    expect(demo?.getAttribute("data-location")).toBe("hero");
  });

  test("renders the packed box as an eager, high-priority AVIF and WebP picture and names both photos by their literal alt", () => {
    const hero = home("minimal").querySelector("#inicio");
    const [box, phone] = hero?.querySelectorAll("picture") ?? [];
    expect(box?.querySelectorAll("source").map((source) => source.getAttribute("type"))).toEqual(["image/avif", "image/webp"]);
    const img = box?.querySelector("img");
    expect(img?.getAttribute("alt")).toBe(
      "La zapatilla ya empacada en su caja, con el rótulo de Yoyos del pedido #1001: Zapatilla Negra Clásica, talla 42, S/ 179.00",
    );
    expect(img?.getAttribute("fetchpriority")).toBe("high");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("width")).toBeTruthy();
    expect(img?.getAttribute("height")).toBeTruthy();
    expect(phone?.querySelector("img")?.getAttribute("alt")).toBe(
      "Chat de WhatsApp donde un cliente envía la foto de una zapatilla negra y pregunta: «Hola, ¿tienen esta en talla 42?»",
    );
    expect(hero?.querySelector('[role="img"]')).toBeNull();
  });

  test("preloads the AVIF candidates with an href taken from the imagesrcset and the picture's sizes", () => {
    const preload = home("minimal").querySelector('link[rel="preload"][as="image"]');
    expect(preload?.getAttribute("fetchpriority")).toBe("high");
    expect(preload?.getAttribute("type")).toBe("image/avif");
    const urls = (preload?.getAttribute("imagesrcset") ?? "").split(",").map((candidate) => candidate.trim().split(" ")[0]);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls).toContain(preload?.getAttribute("href"));
    const avif = home("minimal").querySelector('#inicio picture source[type="image/avif"]');
    expect(preload?.getAttribute("imagesrcset")).toBe(avif?.getAttribute("srcset"));
    expect(preload?.getAttribute("imagesizes")).toBe(avif?.getAttribute("sizes"));
  });
});

describe("problem", () => {
  test("shows the H2, the five bullets and the closing sentence", () => {
    const section = home("minimal").querySelector("#problema");
    expect(text(section?.querySelector("h2"))).toBe("¿Terminó tu live y tu WhatsApp es un caos?");
    expect(section?.querySelectorAll("li").map(text)).toEqual([
      "Copias cada pedido a mano en el cuaderno o el Excel.",
      "Te mandan capturas del live y tienes que adivinar qué producto era.",
      "Pides la dirección y el distrito una y otra vez.",
      "Revisas mil capturas de Yape para saber quién ya pagó.",
      "Escribes cada rótulo a mano antes de ir a la agencia.",
    ]);
    expect(text(section?.querySelector(".closing"))).toBe("Vender en vivo ya es bastante trabajo. Lo demás déjalo en orden.");
  });
});

describe("catalog", () => {
  test("shows the H2, the lead, the five real themes by name and the checkout points on the tape", () => {
    const section = home("minimal").querySelector("#catalogo");
    expect(text(section?.querySelector("h2"))).toBe("Tu catálogo, con el estilo de tu marca");
    expect(text(section?.querySelector(".head p"))).toBe(
      "Un link con tus productos, buscador y carrito. Elige uno de cinco estilos y ponle tu logo.",
    );
    expect(section?.querySelectorAll(".theme-name").map(text)).toEqual(["Clásico", "Boutique", "Antojo", "Suave", "Noche"]);
    expect(section?.querySelectorAll("picture img").map((img) => img.getAttribute("alt"))).toEqual(
      ["Clásico", "Boutique", "Antojo", "Suave", "Noche"].map(
        (theme) => `Catálogo de la tienda demo Zapatillas Lima Store en el estilo ${theme}, con buscador y cuatro productos`,
      ),
    );
    expect(section?.querySelectorAll("picture img").every((img) => img.getAttribute("loading") === "lazy")).toBe(true);
    expect(section?.querySelectorAll(".checkout li").map(text)).toEqual([
      "Tu cliente compra sin crear cuenta",
      "Ve el envío según su distrito",
      "Paga con Yape, Plin o transferencia",
    ]);
  });
});

describe("home structure", () => {
  const order = ["inicio", "problema", "catalogo"];

  test("renders the anchors and H2 headings of the content structure in order", () => {
    const page = home("minimal");
    const sections = page.querySelectorAll("main > section").map((section) => section.getAttribute("id"));
    expect(sections.filter((id) => id && order.includes(id))).toEqual(order);
    expect(page.querySelectorAll("main h2").map(text).slice(0, 2)).toEqual([
      "¿Terminó tu live y tu WhatsApp es un caos?",
      "Tu catálogo, con el estilo de tu marca",
    ]);
    expect(page.querySelectorAll("main h1")).toHaveLength(1);
  });

  test("skips no heading level through the sections from hero to features", () => {
    const levels = headingLevels(home("minimal"));
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((level, index) => expect(level - levels[index]!).toBeLessThanOrEqual(1));
  });

  test("no screenshot is left as a provisional placeholder", () => {
    expect(home("minimal").querySelectorAll("main .screenshot.provisional")).toHaveLength(0);
    expect(home("minimal").querySelectorAll("main .screenshot picture img")).toHaveLength(0);
    expect(home("minimal").text).not.toContain("Imagen provisional");
  });

  test("without a login URL «Ingresar» is absent from header and footer, and with it both link to it", () => {
    const loginLinks = (variant: "minimal" | "full") =>
      home(variant).querySelectorAll("header a, footer a").filter((link) => text(link) === "Ingresar");
    expect(loginLinks("minimal")).toHaveLength(0);
    expect(loginLinks("full").map((link) => link.getAttribute("href"))).toEqual([
      "https://app.example.test/login",
      "https://app.example.test/login",
    ]);
  });
});
