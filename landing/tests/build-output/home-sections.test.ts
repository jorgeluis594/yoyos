import type { HTMLElement } from "node-html-parser";
import { describe, expect, test } from "vitest";
import { headingLevels, readPage } from "./html";

const text = (node: HTMLElement | null | undefined): string => node?.text.replace(/\s+/g, " ").trim() ?? "";

const home = (variant: "minimal" | "full") => readPage(variant, "index.html");

const heroAlt =
  "Chat de WhatsApp en el que un cliente envía la foto de unas zapatillas y Yoyos la convierte en un pedido con su total";

const stepAlts = [
  "Pantalla de Yoyos para crear un producto con foto y precio",
  "Configuración de zonas de envío y datos de pago con Yape, Plin o transferencia",
  "Código QR en la app de Yoyos para vincular WhatsApp desde Dispositivos vinculados",
  "Pedido creado a partir de la foto que envió un cliente por WhatsApp",
  "Link del pedido con opciones de entrega a domicilio, agencia o recojo y pago con Yape o Plin",
];

const steps = [
  ["Sube tus productos", "Agrega cada producto con su foto y su precio, desde la web o la app. La foto es la que Yoyos usa para reconocer el producto. Si quieres, imprime su etiqueta QR desde la app."],
  ["Configura tus entregas y tus datos de pago", "Define tus zonas y precios de envío (a domicilio, por agencia Shalom u Olva o recojo en tienda) y agrega tus datos de Yape, Plin o transferencia."],
  ["Vincula tu WhatsApp", "Abre la app de Yoyos en tu Android y escanea el QR con tu WhatsApp, desde Dispositivos vinculados, como en WhatsApp Web."],
  ["Recibe pedidos", "Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido. Tu cliente también puede comprar desde tu catálogo, que compartes en Instagram, TikTok o WhatsApp."],
  ["Cobra y despacha", "Comparte el link del pedido con tu cliente: confirma sus datos, elige cómo recibirlo (a domicilio, en agencia Shalom u Olva o con recojo en tienda) y paga con Yape, Plin o transferencia subiendo su comprobante. Tú verificas el pago e imprimes el rótulo desde la app."],
] as const;

const features = [
  ["Pedidos desde las fotos de WhatsApp.", "Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido en ese chat."],
  ["Búsqueda de productos por imagen o QR.", "¿Te mandaron una captura del live? Yoyos encuentra el producto en tu catálogo por su etiqueta QR o por la imagen."],
  ["Catálogo para compartir.", "Un link con tus productos, buscador y carrito, listo para tu bio de Instagram o TikTok y tus estados de WhatsApp."],
  ["Checkout con zonas y distritos.", "Defines tus zonas y precios de envío por departamento, provincia o distrito, y tu cliente ve el costo según dónde vive."],
  ["Cobros con Yape, Plin o transferencia.", "Tu cliente ve tus datos de pago, sube su comprobante y tú lo verificas."],
  ["Rótulos para tus envíos.", "Imprime los rótulos de tus envíos en lote desde la app. La guía la sigues sacando en la agencia."],
] as const;

const benefits = [
  ["Menos tiempo copiando pedidos.", "Cuando tu cliente te manda la foto del producto, Yoyos arma el pedido."],
  ["Menos errores en el envío.", "Tu cliente elige su departamento, provincia y distrito de una lista, y su agencia de destino. Nada de direcciones a medias."],
  ["Cobros claros.", "Ves qué pedidos tienen pago reportado y cuáles ya verificaste."],
  ["Tu marca en cada link.", "Catálogo y checkout con tu logo y tu color."],
  ["En tu celular y en la compu.", "App para Android, iPhone próximamente, y versión web, con modo oscuro para tus lives de noche."],
] as const;

describe("hero", () => {
  test("shows the eyebrow, H1, bajada, WhatsApp CTA, call link and microcopy literally", () => {
    const hero = home("full").querySelector("#inicio");
    expect(text(hero?.querySelector(".pill-label"))).toBe("Hecho para vendedores de TikTok LIVE en Perú");
    expect(text(hero?.querySelector("h1"))).toBe("Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE");
    expect(text(hero?.querySelector(".lead"))).toBe(
      "Automatizamos las ventas por redes sociales: tus clientes te escriben por WhatsApp como siempre y, cuando te mandan la foto del producto, Yoyos arma el pedido para que dejes de copiar pedidos a mano. Tú vendes, nosotros operamos.",
    );
    const chat = hero?.querySelector('[data-event="whatsapp_click"]');
    expect(text(chat)).toBe("Escríbenos por WhatsApp");
    expect(chat?.getAttribute("data-location")).toBe("hero");
    expect(chat?.getAttribute("href")).toContain("https://wa.me/51912345678");
    const call = hero?.querySelector('[data-event="call_click"]');
    expect(text(call)).toBe("¿Prefieres hablar? Llámanos");
    expect(call?.getAttribute("data-location")).toBe("hero");
    expect(call?.getAttribute("href")).toBe("tel:+51912345678");
    expect(text(hero?.querySelector(".microcopy"))).toBe(
      "Disponible para Android. iPhone próximamente. S/ 50 al mes + IGV, sin comisión por venta.",
    );
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

  test("renders the hero image slot as a provisional marker named by the literal alt", () => {
    const slot = home("minimal").querySelector('#inicio [role="img"]');
    expect(slot?.getAttribute("aria-label")).toBe(heroAlt);
    expect(text(slot)).toContain("Imagen provisional");
    expect(home("minimal").querySelectorAll("#inicio img")).toHaveLength(0);
    expect(home("minimal").querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(0);
  });
});

describe("value strip", () => {
  test("shows the three items and the closing sentence without a heading", () => {
    const strip = home("minimal").querySelector('[data-section="value-strip"]');
    expect(strip?.querySelectorAll("h2, h3")).toHaveLength(0);
    expect(strip?.querySelectorAll("li").map((item) => [text(item.querySelector(".item-title")), text(item.querySelector(".item-text"))])).toEqual([
      ["Te mandan la foto, Yoyos arma el pedido", "Tu cliente te manda la foto del producto por WhatsApp y Yoyos arma el pedido."],
      ["Un link para cerrar la venta", "Compartes con tu cliente el link de su pedido: confirma sus datos, elige cómo recibirlo y paga desde su celular, sin crear cuenta."],
      ["Despacho en orden", "Zonas de envío, agencias Shalom y Olva, recojo en tienda y rótulos para tus paquetes."],
    ]);
    expect(text(strip?.querySelector(".closing"))).toBe("Tú vendes, nosotros operamos.");
    expect(strip?.querySelectorAll("svg").every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
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

describe("benefits", () => {
  test("shows the H2, the bajada and the five cards", () => {
    const section = home("minimal").querySelector("#beneficios");
    expect(text(section?.querySelector("h2"))).toBe("Gestión de pedidos por WhatsApp sin copiar a mano");
    expect(text(section?.querySelector(".lead"))).toBe("Vende en tu live y deja que Yoyos ordene lo demás.");
    expect(section?.querySelectorAll("li").map((card) => [text(card.querySelector(".card-title")), text(card.querySelector(".card-text"))])).toEqual(
      benefits.map(([title, body]) => [title, body]),
    );
    expect(section?.querySelectorAll("h3")).toHaveLength(0);
  });
});

describe("how it works", () => {
  test("shows the H2 and five H3 steps in order with their text", () => {
    const section = home("minimal").querySelector("#como-funciona");
    expect(text(section?.querySelector("h2"))).toBe("Cómo funciona Yoyos en 5 pasos");
    expect(section?.querySelectorAll("h3").map(text)).toEqual(steps.map(([title]) => title));
    expect(section?.querySelectorAll("li").map((step) => text(step.querySelector(".card-text")))).toEqual(steps.map(([, body]) => body));
  });

  test("gives each provisional step capture its literal alt", () => {
    const slots = home("minimal").querySelectorAll('#como-funciona [role="img"]');
    expect(slots.map((slot) => slot.getAttribute("aria-label"))).toEqual(stepAlts);
    expect(slots.every((slot) => text(slot).includes("Imagen provisional"))).toBe(true);
  });
});

describe("features", () => {
  test("shows the H2 and six H3 cards in order with their text", () => {
    const section = home("minimal").querySelector("#funciones");
    expect(text(section?.querySelector("h2"))).toBe("Todo para vender por WhatsApp, Instagram y TikTok LIVE");
    expect(section?.querySelectorAll("h3").map(text)).toEqual(features.map(([title]) => title));
    expect(section?.querySelectorAll("li").map((card) => text(card.querySelector(".card-text")))).toEqual(features.map(([, body]) => body));
  });

  test("marks every feature capture as provisional and decorative because the content gives no alt", () => {
    const slots = home("minimal").querySelectorAll("#funciones .screenshot");
    expect(slots).toHaveLength(6);
    for (const slot of slots) {
      expect(text(slot)).toContain("Imagen provisional");
      expect(slot.getAttribute("role")).toBeUndefined();
      expect(slot.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("home structure", () => {
  const order = ["inicio", "problema", "beneficios", "como-funciona", "funciones"];

  test("renders the anchors and H2 headings of the content structure in order", () => {
    const page = home("minimal");
    const sections = page.querySelectorAll("main > section").map((section) => section.getAttribute("id"));
    expect(sections.filter((id) => id && order.includes(id))).toEqual(order);
    expect(page.querySelectorAll("main h2").map(text).slice(0, 4)).toEqual([
      "¿Terminó tu live y tu WhatsApp es un caos?",
      "Gestión de pedidos por WhatsApp sin copiar a mano",
      "Cómo funciona Yoyos en 5 pasos",
      "Todo para vender por WhatsApp, Instagram y TikTok LIVE",
    ]);
    expect(page.querySelectorAll("main h1")).toHaveLength(1);
  });

  test("skips no heading level through the sections from hero to features", () => {
    const levels = headingLevels(home("minimal"));
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((level, index) => expect(level - levels[index]!).toBeLessThanOrEqual(1));
  });

  test("every provisional screenshot shows «Imagen provisional» and carries its literal alt as accessible name", () => {
    const slots = home("minimal").querySelectorAll('main .screenshot[role="img"]');
    expect(slots.map((slot) => slot.getAttribute("aria-label"))).toEqual([heroAlt, ...stepAlts]);
    expect(slots.every((slot) => text(slot).includes("Imagen provisional"))).toBe(true);
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
