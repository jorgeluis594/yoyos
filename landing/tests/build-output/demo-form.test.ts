import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { files, distPath, readPage } from "./html";
import { demoText, phoneDisplay } from "./variants";

const whatsapp = "https://wa.me/51912345678";
const homeText = (variant: "minimal" | "full") => readPage(variant, "index.html").text;

describe("demo form", () => {
  test("without a form action the form, the separator and every «Agenda una demo» link are absent", () => {
    const page = readPage("minimal", "index.html");
    expect(page.querySelector("form")).toBeNull();
    expect(page.text).not.toContain("Agenda una demo");
    expect(page.text).not.toContain("o agenda una demo");
    expect(page.querySelectorAll("a").filter((link) => link.getAttribute("href") === "#demo")).toHaveLength(0);
    const demo = page.querySelector("#demo");
    expect(demo?.querySelector("h2")?.text.trim()).toBe("Tu próximo live, con los pedidos en orden");
    expect(demo?.text).toContain(
      "Escríbenos por WhatsApp o llámanos, y en la demo te ayudamos a dejar Yoyos listo con tus productos. S/ 50 al mes + IGV, sin comisión por venta.",
    );
    expect(demo?.querySelector('a[data-event="whatsapp_click"]')?.getAttribute("href")).toBe(whatsapp);
    expect(demo?.querySelector('a[data-event="call_click"]')?.text.trim()).toBe("Llámanos");
    expect(demo?.text).toContain("+51912345678");
  });

  test("with a form action the form posts to it with the contract field names, honeypot and consent version", () => {
    const page = readPage("full", "index.html");
    const form = page.querySelector("#demo form");
    expect(form?.getAttribute("action")).toBe("https://crm.example.test/demo");
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(form?.getAttribute("enctype")).toBe("application/x-www-form-urlencoded");
    expect(form?.getAttribute("accept-charset")).toBe("UTF-8");
    const names = form?.querySelectorAll("[name]").map((field) => field.getAttribute("name"));
    expect(new Set(names)).toEqual(
      new Set(["nombre", "telefono", "rubro", "contacto_preferido", "consentimiento", "consent_text_version", "website"]),
    );
    expect(form?.querySelector('[name="consent_text_version"]')?.getAttribute("value")).toBe("privacidad-v1-2026-10");
    expect(form?.querySelector('[name="consentimiento"]')?.getAttribute("value")).toBe("acepto");
    const honeypot = form?.querySelector('[name="website"]');
    expect(honeypot?.getAttribute("tabindex")).toBe("-1");
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(form?.querySelector("h3")?.text.trim()).toBe("Agenda una demo");
    expect(form?.text).toContain("Déjanos tus datos y te contactamos para mostrarte Yoyos.");
    expect(form?.querySelector('button[type="submit"]')?.text.trim()).toBe("Agendar mi demo");
    expect(homeText("full")).toContain("o agenda una demo");
  });

  test("offers the six rubros, WhatsApp as the default contact method and the placeholders of the content", () => {
    const form = readPage("full", "index.html").querySelector("#demo form");
    expect(form?.querySelectorAll('select[name="rubro"] option').map((option) => [option.getAttribute("value"), option.text.trim()])).toEqual([
      ["", "Elige una opción"],
      ["ropa", "Ropa"],
      ["zapatillas", "Zapatillas"],
      ["joyeria_accesorios", "Joyería y accesorios"],
      ["mascotas", "Mascotas"],
      ["cosmeticos", "Cosméticos"],
      ["otro", "Otro"],
    ]);
    const radios = form?.querySelectorAll('input[name="contacto_preferido"]');
    expect(radios?.map((radio) => radio.getAttribute("value"))).toEqual(["whatsapp", "llamada"]);
    expect(radios?.map((radio) => radio.hasAttribute("checked"))).toEqual([true, false]);
    expect(form?.querySelector('[name="nombre"]')?.getAttribute("placeholder")).toBe("Ej.: Rosa Quispe");
    expect(form?.querySelector('[name="telefono"]')?.getAttribute("placeholder")).toBe("9XX XXX XXX");
    expect(form?.text).toContain("+51");
  });

  test("the consent checkbox is required, unchecked and links to /privacidad in a new tab", () => {
    const form = readPage("full", "index.html").querySelector("#demo form");
    const consent = form?.querySelector('input[name="consentimiento"]');
    expect(consent?.getAttribute("type")).toBe("checkbox");
    expect(consent?.hasAttribute("required")).toBe(true);
    expect(consent?.hasAttribute("checked")).toBe(false);
    const label = form?.querySelector(`label[for="${consent?.getAttribute("id")}"]`);
    expect(label?.text.replace(/\s+/g, " ").trim()).toBe(
      "He leído la Política de privacidad y autorizo a Yoyos a usar mis datos (nombre, celular, rubro y forma de contacto) para contactarme por WhatsApp o llamada sobre la demo y la oferta comercial de Yoyos.",
    );
    const link = label?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/privacidad");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
    expect(consent?.getAttribute("data-error")).toBe("Para enviar tus datos necesitamos que aceptes la Política de privacidad.");
  });

  test("the nombre field rejects a name made only of spaces", () => {
    const nombre = readPage("full", "index.html").querySelector('input[name="nombre"]');
    const pattern = new RegExp(`^(?:${nombre?.getAttribute("pattern")})$`, "v");
    expect(["Rosa", " Rosa ", "Rosa Quispe"].every((value) => pattern.test(value))).toBe(true);
    expect(["", " ", "     "].some((value) => pattern.test(value))).toBe(false);
  });

  test("the telefono field requires 9 digits starting with 9", () => {
    const telefono = readPage("full", "index.html").querySelector('input[name="telefono"]');
    expect(telefono?.hasAttribute("required")).toBe(true);
    expect(telefono?.getAttribute("type")).toBe("tel");
    expect(telefono?.getAttribute("inputmode")).toBe("tel");
    expect(telefono?.getAttribute("autocomplete")).toBe("tel-national");
    const pattern = new RegExp(`^(?:${telefono?.getAttribute("pattern")})$`);
    expect(["912345678", "999999999", "912 345 678", "912 345678", "912345 678"].every((value) => pattern.test(value))).toBe(true);
    expect(["91234567", "812345678", "9123456789", "9123abcde", "91 2345 678", "912  345 678", " 912345678"].some((value) => pattern.test(value))).toBe(false);
    expect(telefono?.getAttribute("data-error")).toBe("Escribe un celular de 9 dígitos que empiece con 9.");
  });

  test("every field carries its literal error message and an error element referenced by aria-describedby", () => {
    const form = readPage("full", "index.html").querySelector("#demo form");
    const messages: Record<string, string> = {
      nombre: "Escribe tu nombre.",
      rubro: "Elige qué vendes.",
      contacto_preferido: "Elige cómo te contactamos.",
    };
    for (const [name, message] of Object.entries(messages)) {
      const field = form?.querySelector(`[name="${name}"]`);
      expect(field?.getAttribute("data-error")).toBe(message);
      expect(field?.hasAttribute("required")).toBe(true);
    }
    for (const name of ["nombre", "telefono", "rubro", "consentimiento"]) {
      const field = form?.querySelector(`[name="${name}"]`);
      const error = form?.querySelector(`#${name}-error`);
      expect(field?.getAttribute("aria-describedby")).toContain(`${name}-error`);
      expect(error?.hasAttribute("hidden")).toBe(true);
    }
  });

  test("the privacy note names the configured email and links the privacy policy", () => {
    const note = (variant: "minimal" | "full") =>
      readPage(variant, "index.html").querySelector("#demo .privacy-note")?.text.replace(/\s+/g, " ").trim();
    expect(note("full")).toBe(
      "Tus datos se guardan en nuestro sistema de gestión de clientes y solo los usamos para contactarte sobre Yoyos. Puedes pedir que los corrijamos o borremos, o dejar de recibir contacto, escribiéndonos por WhatsApp o a hola@example.test. Más detalles en nuestra Política de privacidad.",
    );
    expect(readPage("full", "index.html").querySelector("#demo .privacy-note a")?.getAttribute("href")).toBe("/privacidad");
  });

  test("without email and social variables their footer links and sentences are absent; with them they render", () => {
    const footer = (variant: "minimal" | "full") => readPage(variant, "index.html").querySelector("footer");
    const minimal = footer("minimal");
    expect(minimal?.querySelectorAll("a").filter((link) => link.getAttribute("href")?.startsWith("mailto:"))).toHaveLength(0);
    expect(minimal?.text).not.toContain("Correo:");
    for (const label of ["TikTok", "Instagram"]) expect(minimal?.text).not.toContain(label);
    const full = footer("full");
    expect(full?.querySelector('a[href="mailto:hola@example.test"]')?.text.trim()).toBe("Correo: hola@example.test");
    expect(full?.querySelector('a[href="https://www.tiktok.com/@yoyos-test"]')?.text.trim()).toBe("TikTok");
    expect(full?.querySelector('a[href="https://www.instagram.com/yoyos-test"]')?.text.trim()).toBe("Instagram");
    expect(homeText("minimal")).not.toContain("hola@example.test");
  });

  test("the success and error blocks exist with their target ids and literal messages", () => {
    const demo = readPage("full", "index.html").querySelector("#demo");
    const clean = (text: string | undefined) => text?.replace(/\s+/g, " ").trim();
    expect(clean(demo?.querySelector("#demo-ok-whatsapp")?.text)).toBe(
      "¡Listo! Te contactaremos pronto por WhatsApp. Si prefieres no esperar, escríbenos por WhatsApp.",
    );
    expect(clean(demo?.querySelector("#demo-ok-llamada")?.text)).toBe(
      "¡Listo! Te contactaremos pronto por llamada. Si prefieres no esperar, escríbenos por WhatsApp.",
    );
    expect(clean(demo?.querySelector("#demo-error")?.text)).toBe(
      "No pudimos enviar tus datos. Inténtalo de nuevo o escríbenos por WhatsApp.",
    );
    for (const id of ["demo-ok-whatsapp", "demo-ok-llamada", "demo-error"]) {
      const link = demo?.querySelector(`#${id} a`);
      expect(link?.getAttribute("href")).toBe(`${whatsapp}?text=${encodeURIComponent(demoText)}`);
      expect(link?.getAttribute("data-location")).toBe("cta_final");
    }
  });

  test("the enhancement script carries no copy", () => {
    const bundle = files(distPath("full", "_astro"))
      .filter((file) => file.includes("demo-form"))
      .map((file) => readFileSync(file, "utf8"))
      .join("");
    expect(bundle).toContain("telefono");
    for (const copy of ["Ropa", "Por WhatsApp", "Enviando", "Escribe", "Elige"]) expect(bundle).not.toContain(copy);
  });

  test("the enhancement script stays within 2 KB, counting the chunks it imports", () => {
    const entries = files(distPath("full", "_astro")).filter((file) => file.includes("demo-form") && file.endsWith(".js"));
    expect(entries).toHaveLength(1);
    const reachable = new Set<string>();
    const visit = (file: string): void => {
      if (reachable.has(file)) return;
      reachable.add(file);
      const imports = readFileSync(file, "utf8").matchAll(/(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g);
      for (const [, specifier] of imports) visit(join(dirname(file), specifier ?? ""));
    };
    visit(entries[0] ?? "");
    expect(reachable.size).toBeGreaterThan(1);
    const bytes = [...reachable].reduce((total, file) => total + statSync(file).size, 0);
    expect(bytes).toBeLessThanOrEqual(2048);
  });

  test("the integrations logo list carries no invented accessible name", () => {
    expect(readPage("minimal", "index.html").querySelector("#integraciones .logos")?.hasAttribute("aria-label")).toBe(false);
  });

  test("renders no success or error block without a form action", () => {
    const page = readPage("minimal", "index.html");
    for (const id of ["demo-ok-whatsapp", "demo-ok-llamada", "demo-error"]) expect(page.querySelector(`#${id}`)).toBeNull();
  });
});

describe("pricing, integrations, FAQ and testimonials", () => {
  test("FAQ 6 and the testimonials section are not rendered", () => {
    for (const variant of ["minimal", "full"] as const) {
      const page = readPage(variant, "index.html");
      expect(page.querySelector("#testimonios")).toBeNull();
      expect(page.text).not.toContain("¿Qué pasa con mis datos y los de mis clientes?");
      expect(page.text).not.toContain("Vendedores de TikTok LIVE que ya ordenan");
      expect(page.querySelector('#preguntas details[data-faq-q="6"]')).toBeNull();
    }
  });

  test("the FAQ lists questions 1–5 and 7–11 as details with H3 questions and analytics attributes", () => {
    const faq = readPage("minimal", "index.html").querySelector("#preguntas");
    expect(faq?.querySelector("h2")?.text.trim()).toBe("Preguntas frecuentes");
    const entries = faq?.querySelectorAll("details") ?? [];
    expect(entries.map((entry) => entry.getAttribute("data-faq-q"))).toEqual(["1", "2", "3", "4", "5", "7", "8", "9", "10", "11"]);
    expect(entries.every((entry) => entry.querySelector("summary h3") !== null)).toBe(true);
    // faq_open is built only by the toggle listener, so no FAQ element may carry data-event (the click listener matches it).
    expect(faq?.querySelectorAll("[data-event]")).toHaveLength(0);
    expect(entries[2]?.querySelector("h3")?.text.trim()).toBe("¿Cuánto cuesta?");
    expect(entries.every((entry) => !entry.hasAttribute("open"))).toBe(true);
  });

  test("the pricing card shows the price, the IGV note and the eight included items", () => {
    const pricing = readPage("full", "index.html").querySelector("#precio");
    expect(pricing?.querySelector("h2")?.text.trim()).toBe("Un solo precio: S/ 50 al mes + IGV. Sin comisión por venta.");
    const text = pricing?.text.replace(/\s+/g, " ");
    for (const copy of [
      "Yoyos",
      "S/ 50",
      "/ mes + IGV",
      "Los precios no incluyen IGV.",
      "Suscripción mensual. Sin comisión por tus ventas y sin pagos únicos.",
      "Incluye",
      "En la demo te ayudamos a dejar Yoyos listo con tus productos.",
    ]) {
      expect(text).toContain(copy);
    }
    expect(pricing?.querySelectorAll("li").map((item) => item.text.trim())).toEqual([
      "Pedidos desde las fotos de WhatsApp",
      "Búsqueda de productos por imagen o QR",
      "Catálogo para compartir",
      "Checkout con zonas y distritos del Perú",
      "Cobros con Yape, Plin o transferencia",
      "Envíos a agencias Shalom y Olva, y recojo en tienda",
      "Rótulos para tus envíos, impresos en lote desde la app",
      "App para Android (iPhone próximamente) y versión web",
    ]);
  });

  test("the pricing buttons track their location and the demo button exists only with the form", () => {
    const full = readPage("full", "index.html").querySelector("#precio");
    expect(full?.querySelector('a[data-event="whatsapp_click"]')?.getAttribute("data-location")).toBe("precio");
    const demo = full?.querySelector('a[data-event="demo_form_open"]');
    expect(demo?.getAttribute("href")).toBe("#demo");
    expect(demo?.getAttribute("data-location")).toBe("precio");
    expect(demo?.text.trim()).toBe("Agenda una demo");
    expect(readPage("minimal", "index.html").querySelector('#precio a[data-event="demo_form_open"]')).toBeNull();
  });

  test("the integrations section lists the four items, the four real logos with their alt and the trademark note", () => {
    const section = readPage("minimal", "index.html").querySelector("#integraciones");
    expect(section?.querySelector("h2")?.text.trim()).toBe("Envíos por agencias Shalom y Olva, cobros con Yape y Plin");
    const text = section?.text.replace(/\s+/g, " ");
    for (const copy of [
      "Funciona con lo que ya usas.",
      "Vinculas tu WhatsApp desde la app, como en WhatsApp Web. Tus clientes te siguen escribiendo como siempre.",
      "Configura envíos a agencias Shalom y Olva. Tu cliente elige la sede de destino y tú imprimes el rótulo. La guía la sigues sacando en la agencia.",
      "Si tu cliente prefiere recoger, también puede elegirlo.",
      "Muestra tus datos de cobro y recibe el comprobante en cada pedido.",
      "WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños. Yoyos no está afiliado a ellas.",
    ]) {
      expect(text).toContain(copy);
    }
    const logos = section?.querySelectorAll("[data-partner-logo]") ?? [];
    expect(logos.map((logo) => [logo.getAttribute("data-partner-logo"), logo.getAttribute("alt")])).toEqual([
      ["Shalom", "Logo de Shalom"],
      ["Olva", "Logo de Olva"],
      ["Yape", "Logo de Yape"],
      ["Plin", "Logo de Plin"],
    ]);
    expect(logos.every((logo) => logo.tagName.toLowerCase() === "img")).toBe(true);
    expect(logos.every((logo) => /^\/_astro\/.+\.(png|svg|webp)$/.test(logo.getAttribute("src") ?? ""))).toBe(true);
    expect(logos.every((logo) => Number(logo.getAttribute("width")) > 0 && Number(logo.getAttribute("height")) > 0)).toBe(true);
    expect(section?.querySelectorAll("[data-provisional]").length).toBe(0);
  });

  test("the phone number shown in the final CTA is the configured display", () => {
    expect(readPage("full", "index.html").querySelector("#demo")?.text).toContain(phoneDisplay);
  });
});
