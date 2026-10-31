import { describe, expect, test } from "vitest";
import {
  customerLabel, destinationLabel, displayName, isPhoneLikeName, maskDigitRuns, maskPhone, normalizeText, recipientLabel, shortItemNames, toAssistantDispatchEntry, toAssistantOrder, toAssistantOrderSummary,
  type ProjectableDelivery, type ProjectableOrder, type ProjectionContext,
} from "@core/src/features/assistants/domain/order-projection";
import { display } from "@core/src/features/assistants/presentation/display";
import { readinessText } from "@core/src/features/assistants/presentation/tools/orders-texts";

const context: ProjectionContext = { display, link: (id) => `https://app.yoyos.lat/orders/${id}`, readinessText };
const pen = (amount: number) => ({ amount, currency: "PEN" });
const larco = { address: "Av. Larco 123", instructions: "Portón verde, timbre 2" };
const lima = { district: "Miraflores", province: "Lima", department: "Lima" };
const carla = { name: "Carla Pérez", phone: "+51987654789" };

const homeDelivery: ProjectableDelivery = {
  method: "home", recipient: { name: "Carla Pérez", phone: "+51987654789", identity: { kind: "document", documentType: "national_id", document: "45678912" } } as never,
  destination: { ...lima, ...larco } as never,
};

function order(overrides: Partial<ProjectableOrder> = {}): ProjectableOrder {
  return {
    number: 1001, id: "00000000-0000-4000-8000-000000000001", createdAt: new Date("2026-10-30T15:42:00Z"), scheduledDispatchDate: "2026-10-30", shippedAt: null, deliveredAt: null,
    completedAt: null, cancelled: false, fromCatalog: false, chatId: null, buyer: carla,
    items: [{ variantId: "v-m", productName: "Camisa", variantAttributes: { Talla: "M", Color: "Azul" }, quantity: 2, unitPrice: pen(40), subtotal: pen(80) }],
    payments: [], delivery: homeDelivery, deliveryStatus: "pending", itemsTotal: pen(80), deliveryCharge: pen(0), total: pen(80), ...overrides,
  };
}

describe("masking", () => {
  test("shows only the last three digits of the buyer and recipient phone", () => {
    expect(maskPhone("+51 987 654 789")).toBe("termina en 789");
    expect(maskPhone("12")).toBeNull();
    const full = toAssistantOrder(order(), { stockDue: null }, null, context);
    expect(full.entrega.telefono).toBe("termina en 789");
    expect(JSON.stringify(full)).not.toContain("987654789");
  });

  test("labels a nameless buyer by the last three phone digits", () => {
    expect(customerLabel({ name: null, phone: "987654427" })).toBe("Cliente que termina en 427");
    expect(customerLabel({ name: "  ", phone: "987654427" })).toBe("Cliente que termina en 427");
  });

  test("treats a buyer name made of a phone number as no name", () => {
    expect(isPhoneLikeName("+51 987-654-427")).toBe(true);
    expect(isPhoneLikeName("Local 1234")).toBe(false);
    expect(customerLabel({ name: "+51 987 654 427", phone: null })).toBe("Cliente que termina en 427");
    expect(customerLabel({ name: "987654427", phone: "987654123" })).toBe("Cliente que termina en 123");
  });

  test("labels an order without buyer, or a buyer without name and phone, as Público general", () => {
    expect(customerLabel(null)).toBe("Público general");
    expect(customerLabel({ name: null, phone: null })).toBe("Público general");
    expect(customerLabel({ name: null, phone: "12" })).toBe("Público general");
  });

  test("reduces a home destination to district, province and department", () => {
    expect(destinationLabel(homeDelivery)).toBe("Miraflores, Lima, Lima");
  });

  test("keeps the agency address and the pickup point address because they are business data", () => {
    const agency = { method: "agency", recipient: { name: "Luis", phone: "999111222" }, destination: lima, courier: { name: "Olva Courier" },
      agency: { name: "Agencia Centro", address: "Jr. Unión 450", location: { district: "Cercado", province: "Lima", department: "Lima" } } } as ProjectableDelivery;
    expect(destinationLabel(agency)).toBe("Olva Courier · Agencia Centro, Jr. Unión 450, Cercado, Lima, Lima");
    const pickup = { method: "store", recipient: { name: "Luis", phone: "999111222" }, pickupPoint: { name: "Tienda Rosa", address: "Av. Arequipa 10" } } as ProjectableDelivery;
    expect(destinationLabel(pickup)).toBe("Recojo en tienda · Tienda Rosa, Av. Arequipa 10");
  });

  test("never includes the street, the delivery reference or the identity document in any projected field", () => {
    const projected = JSON.stringify([
      toAssistantOrder(order(), { stockDue: null }, { kind: "ready", operation: "ship" }, context),
      toAssistantOrderSummary(order(), context),
      toAssistantDispatchEntry(order(), "today", { kind: "ready", operation: "ship" }, context),
    ]);
    for (const secret of ["Av. Larco 123", "Portón verde", "45678912", "987654789", "+51987654789"]) expect(projected).not.toContain(secret);
    expect(projected).toContain("Miraflores, Lima, Lima");
  });

  test("shows Entrega por definir when the order has no delivery", () => {
    expect(destinationLabel(null)).toBe("Entrega por definir");
    expect(toAssistantOrder(order({ delivery: null }), { stockDue: null }, { kind: "delivery_unassigned" }, context))
      .toMatchObject({ modalidad: "Por definir", entrega: { destino: "Entrega por definir" }, preparacion: { listo: false, texto: "Entrega por definir: falta asignar la entrega." } });
  });

  test("labels a recipient the same way as a buyer", () => {
    expect(recipientLabel({ name: "Luis Soto", phone: "999111222" })).toBe("Luis Soto");
    expect(recipientLabel({ name: "999111222", phone: "999111222" })).toBe("Cliente que termina en 222");
  });
});

describe("projection", () => {
  test("shows formatted amounts, dates in Lima, states and the link", () => {
    expect(toAssistantOrderSummary(order({ payments: [{ status: "confirmed", amount: pen(30), method: "digital_wallet", data: { confirmedAt: new Date(), evidence: { kind: "manual" } } }] }), context)).toEqual({
      numero: "#1001", creado: "30/10/2026", cliente: "Carla Pérez", origen: "Venta manual", total: "S/ 80.00", recibido: "S/ 30.00", estado_pago: "Pago pendiente",
      por_cobrar: "S/ 50.00", estado_entrega: "Pendiente", modalidad: "A domicilio", despacho_programado: "30/10/2026", enlace: "https://app.yoyos.lat/orders/00000000-0000-4000-8000-000000000001",
    });
  });

  test("counts 23:30 Lima on the 30th as the 30th although it is the 31st in UTC", () => {
    expect(toAssistantOrderSummary(order({ createdAt: new Date("2026-10-31T04:30:00Z") }), context).creado).toBe("30/10/2026");
  });

  test("marks a cancelled order Cancelado with no balance and no readiness", () => {
    const cancelled = toAssistantOrder(order({ cancelled: true }), { stockDue: null }, { kind: "ready", operation: "ship" }, context);
    expect(cancelled).toMatchObject({ estado: "Cancelado" });
    expect(cancelled).not.toHaveProperty("por_cobrar");
    expect(cancelled).not.toHaveProperty("preparacion");
  });

  test("marks the origin as catalog, WhatsApp or manual", () => {
    expect(toAssistantOrderSummary(order({ fromCatalog: true }), context).origen).toBe("Desde el catálogo");
    expect(toAssistantOrderSummary(order({ chatId: "chat-1" }), context).origen).toBe("WhatsApp");
  });

  test("a reported payment does not reduce the balance and flags the order", () => {
    const summary = toAssistantOrderSummary(order({ payments: [{ status: "reported", data: { reportedAt: new Date() } }] }), context);
    expect(summary).toMatchObject({ por_cobrar: "S/ 80.00", pago_por_revisar: true, recibido: "S/ 0.00" });
  });

  test("lists payments with state, amount, method, receipt mention and rejection reason", () => {
    const full = toAssistantOrder(order({ payments: [
      { status: "confirmed", amount: pen(80), method: "bank_transfer", data: { confirmedAt: new Date("2026-10-30T15:42:00Z"), evidence: { kind: "buyer_report" } } },
      { status: "rejected", data: { rejectedAt: new Date("2026-10-29T15:00:00Z"), reason: "Monto incorrecto" } },
    ] }), { stockDue: null }, null, context);
    expect(full.pagos).toEqual([
      { estado: "Confirmado", fecha: "30/10/2026 10:42", monto: "S/ 80.00", metodo: "Transferencia bancaria", con_comprobante: true },
      { estado: "Rechazado", fecha: "29/10/2026 10:00", con_comprobante: true, motivo: "Monto incorrecto" },
    ]);
    expect(full.estado_pago).toBe("Pagado");
  });

  test("shows an overpayment and a delivery charge and the price the customer mentioned only when it differs", () => {
    const full = toAssistantOrder(order({
      payments: [{ status: "confirmed", amount: pen(100), method: "digital_wallet", data: { confirmedAt: new Date(), evidence: { kind: "manual" } } }],
      deliveryCharge: pen(10),
      items: [
        { variantId: "a", productName: "Camisa", variantAttributes: {}, quantity: 2, unitPrice: pen(40), subtotal: pen(80), mentionedPrice: { amount: pen(70), units: 2 } },
        { variantId: "b", productName: "Gorra", variantAttributes: {}, quantity: 1, unitPrice: pen(20), subtotal: pen(20), mentionedPrice: { amount: pen(20), units: 1 } },
      ],
    }), { stockDue: null }, null, context);
    expect(full.sobrepago).toBe("S/ 20.00");
    expect(full.entrega_cobrada).toBe("S/ 10.00");
    expect(full.productos[0]).toMatchObject({ producto: "Camisa", precio_mencionado: "S/ 70.00 por 2" });
    expect(full.productos[1]).not.toHaveProperty("precio_mencionado");
    expect(full.productos[1]).not.toHaveProperty("combinacion");
  });

  test("states waiting and deducting stock", () => {
    expect(toAssistantOrder(order(), { stockDue: { kind: "waiting" } }, null, context).stock).toBe("Esperando stock");
    expect(toAssistantOrder(order(), { stockDue: { kind: "deducting" } }, null, context).stock).toBe("Descontando stock");
  });
});

describe("readiness sentences", () => {
  const sentence = (readiness: Parameters<typeof toAssistantOrder>[2], overrides: Partial<ProjectableOrder> = {}) =>
    toAssistantDispatchEntry(order(overrides), "today", readiness!, context).preparacion;

  test("uses the sentences the web shows next to the fulfillment buttons", () => {
    expect(sentence({ kind: "ready", operation: "ship" })).toEqual({ listo: true, texto: "Listo para despachar" });
    expect(sentence({ kind: "ready", operation: "deliver" }).texto).toBe("Listo para entregar");
    expect(sentence({ kind: "blocked", operation: "ship", reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: false } }).texto).toBe("Se requiere al menos un pago para despachar.");
    expect(sentence({ kind: "blocked", operation: "ship", reason: { code: "SHIP_PAYMENT_REQUIRED", pendingReport: true } }).texto)
      .toBe("Se requiere al menos un pago para despachar. Tiene un pago por revisar.");
    expect(sentence({ kind: "blocked", operation: "deliver", reason: { code: "PAYMENT_REQUIRED", pendingReport: false } }, { total: pen(80), payments: [] }).texto)
      .toBe("Registra al menos un pago para entregar. Puede ser un pago parcial. Por cobrar: S/ 80.00.");
  });

  test("names the short items as Camisa (M · Azul) and only once when the order has two lines of the same variant", () => {
    const twoLines = order({ items: [
      { variantId: "v-m", productName: "Camisa", variantAttributes: { Talla: "M", Color: "Azul" }, quantity: 2, unitPrice: pen(40), subtotal: pen(80) },
      { variantId: "v-m", productName: "Camisa", variantAttributes: { Talla: "M", Color: "Azul" }, quantity: 1, unitPrice: pen(40), subtotal: pen(40) },
      { variantId: "v-l", productName: "Camisa", variantAttributes: { Talla: "L" }, quantity: 1, unitPrice: pen(40), subtotal: pen(40) },
    ] });
    expect(shortItemNames(twoLines, ["v-m", "v-m", "v-l"])).toEqual(["Camisa (M · Azul)", "Camisa (L)"]);
    expect(sentence({ kind: "blocked", operation: "ship", reason: { code: "STOCK_WAITING", variantIds: ["v-m", "v-m"] } }, twoLines).texto).toBe("Para despachar falta stock de Camisa (M · Azul).");
    expect(sentence({ kind: "blocked", operation: "deliver", reason: { code: "STOCK_WAITING", variantIds: ["v-l"] } }, twoLines).texto).toBe("Para entregar falta stock de Camisa (L).");
  });

  test("names a variant without combination by its product name", () => {
    expect(shortItemNames(order({ items: [{ variantId: "u", productName: "Gorra", variantAttributes: {}, quantity: 1, unitPrice: pen(20), subtotal: pen(20) }] }), ["u"])).toEqual(["Gorra"]);
  });
});

describe("budget", () => {
  test("shortens a very long product name, combination and rejection reason", () => {
    const long = "x".repeat(300);
    const full = toAssistantOrder(order({
      items: [{ variantId: "v", productName: long, variantAttributes: { Talla: long }, quantity: 1, unitPrice: pen(1), subtotal: pen(1) }],
      payments: [{ status: "rejected", data: { rejectedAt: new Date(), reason: long } }],
    }), { stockDue: null }, null, context);
    expect(full.productos[0]!.producto).toHaveLength(100);
    expect(full.productos[0]!.combinacion).toHaveLength(50);
    expect(full.pagos[0]!.motivo).toHaveLength(100);
    expect(full.productos[0]!.producto.endsWith("…")).toBe(true);
  });
});

describe("pending payment report", () => {
  test("flags a fully paid order that still has a payment report to review, but not a cancelled one", () => {
    const payments = [
      { status: "confirmed" as const, amount: pen(80), method: "digital_wallet" as const, data: { confirmedAt: new Date(), evidence: { kind: "manual" as const } } },
      { status: "reported" as const, data: { reportedAt: new Date() } },
    ];
    expect(toAssistantOrderSummary(order({ payments }), context)).toMatchObject({ estado_pago: "Pagado", pago_por_revisar: true });
    expect(toAssistantOrderSummary(order({ payments, cancelled: true }), context)).not.toHaveProperty("pago_por_revisar");
  });
});

describe("names never carry a complete phone", () => {
  const nbsp = "\u00a0", zwsp = "\u200b";
  test("masks a long digit run inside a name and keeps the rest", () => {
    expect(maskDigitRuns("Carla 987654444")).toBe("Carla •••444");
    expect(maskDigitRuns("Carla (987) 654-444 Pérez")).toBe("Carla •••444 Pérez");
  });

  test("ignores separators, no-break spaces, zero-width characters and fullwidth digits", () => {
    expect(maskDigitRuns("987/654/777")).toBe("•••777");
    expect(maskDigitRuns(`987${nbsp}654${nbsp}111`)).toBe("•••111");
    expect(maskDigitRuns(`987${zwsp}654222`)).toBe("•••222");
    expect(maskDigitRuns("９８７６５４３３３")).toBe("•••333");
    expect(maskDigitRuns("+51 987-654-321")).toBe("•••321");
    expect(maskDigitRuns("987.654.123")).toBe("•••123");
    expect(maskDigitRuns("\u202e987654555\u202c")).toBe("•••555");
  });

  test("treats any dash, underscore, comma, dot, colon, apostrophe or asterisk between digits as a separator", () => {
    for (const separator of ["\u2010", "\u2011", "\u2013", "\u2014", "\u2212", "_", ",", "·", "'", ":", "*", " - ", "\u2012"]) {
      expect(maskDigitRuns(`987${separator}654${separator}321`), separator).toBe("•••321");
    }
  });

  test("treats every Unicode numeric character as a digit (circled, dingbat, superscript, subscript)", () => {
    expect(maskDigitRuns("Carla ❾❽❼❻❺❹❸❷❶")).toBe("Carla •••❸❷❶");
    expect(maskDigitRuns("Carla ➒➑➐➏➎➍➌➋➊")).toBe("Carla •••➌➋➊");
    expect(maskDigitRuns("⑨⑧⑦⑥⑤④③②①")).toBe("•••321");
    expect(maskDigitRuns("⁹⁸⁷⁶⁵⁴³²¹")).toBe("•••321");
    expect(maskDigitRuns("₉₈₇₆₅₄₃₂₁")).toBe("•••321");
    expect(maskDigitRuns("❾❽❼ ➏➎➍ ③②①")).toBe("•••321");
    expect(maskDigitRuns("Tienda ❷❹")).toBe("Tienda ❷❹");
    expect(isPhoneLikeName("❾❽❼❻❺❹❸❷❶")).toBe(true);
    expect(customerLabel({ name: "❾❽❼❻❺❹❸❷❶", phone: null })).toBe("Cliente que termina en ❸❷❶");
  });

  test("removes invisible Hangul fillers and other default-ignorable code points", () => {
    for (const filler of ["\u3164", "\uffa0", "\u115f", "\u1160", "\u034f", "\ufe0f"]) {
      expect(maskDigitRuns(`Carla 987${filler}654${filler}321`), filler.codePointAt(0)!.toString(16)).toBe("Carla •••321");
    }
    expect(customerLabel({ name: "987\u3164654\u3164321", phone: null })).toBe("Cliente que termina en 321");
    expect(maskDigitRuns("김민지")).toBe("김민지");
  });

  test("keeps the last three numeric characters as whole code points", () => {
    expect(maskDigitRuns("𐄇𐄈𐄉𐄊𐄋𐄌𐄍𐄎𐄏")).toBe("•••𐄍𐄎𐄏");
  });

  test("no code point lets the nine digits of a phone be read in order", () => {
    const digits = "987654321";
    const numeric = (text: string) => Array.from(text.normalize("NFKC")).filter((char) => /\p{N}/u.test(char)).join("");
    const failures: string[] = [];
    let checked = 0;
    for (let code = 0; code <= 0x10ffff; code++) {
      const char = String.fromCodePoint(code);
      const visible = normalizeText(char);
      if (/[\p{L}\p{N}]/u.test(visible)) continue; // a visible letter breaks a run on purpose; a digit is not a separator
      checked++;
      const output = customerLabel({ name: `Carla 987${char}654${char}321`, phone: null });
      const readable = numeric(output);
      if (readable.length > 3 || !digits.endsWith(readable)) failures.push(`U+${code.toString(16)} → ${output}`);
    }
    expect(checked).toBeGreaterThan(900_000);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 60_000);

  test("keeps combining marks on letters while removing them after numeric characters", () => {
    expect(maskDigitRuns("Jose\u0301 Pérez")).toBe("José Pérez");
    expect(maskDigitRuns("प्रिया")).toBe("प्रिया");
  });

  test("ignores keycap emoji digits and combining marks on digits", () => {
    expect(maskDigitRuns("Carla 9\ufe0f\u20e38\ufe0f\u20e37\ufe0f\u20e36\ufe0f\u20e35\ufe0f\u20e34\ufe0f\u20e33\ufe0f\u20e32\ufe0f\u20e31\ufe0f\u20e3")).toBe("Carla •••321");
    expect(maskDigitRuns("9\u03018\u03017\u03016\u03015\u03014\u03013\u0301")).toBe("•••543");
  });

  test("keeps short numbers separated from other numbers by letters", () => {
    expect(maskDigitRuns("Local 12 - Piso 3")).toBe("Local 12 - Piso 3");
  });

  test("keeps a name with a short number", () => {
    expect(maskDigitRuns("Tienda 24")).toBe("Tienda 24");
    expect(displayName("Tienda 24")).toBe("Tienda 24");
    expect(maskDigitRuns("Local 12 y 34")).toBe("Local 12 y 34");
  });

  test("treats a name left without letters as no name", () => {
    for (const name of ["987654789", "+51 987-654-789", "987/654/777", `987${nbsp}654${nbsp}111`, `987${zwsp}654222`, "９８７６５４３３３", "٩٨٧٦٥٤", "(01) 987-654"]) {
      expect(isPhoneLikeName(name), name).toBe(true);
      expect(displayName(name), name).toBeNull();
    }
    for (const name of ["98765", "Carla 987654789", "Local 12", "987654a", ""]) expect(isPhoneLikeName(name), name).toBe(false);
  });

  test("shows the buyer and the recipient without any complete phone", () => {
    expect(customerLabel({ name: "Carla 987654444", phone: "+51987654444" })).toBe("Carla •••444");
    expect(customerLabel({ name: `987${nbsp}654${nbsp}111`, phone: null })).toBe("Cliente que termina en 111");
    expect(customerLabel({ name: "987/654/777", phone: "+51987000123" })).toBe("Cliente que termina en 123");
    expect(recipientLabel({ name: "Luis 999111222", phone: "999111222" })).toBe("Luis •••222");
    const full = toAssistantOrder(order({ buyer: { name: "Carla 987654444", phone: "+51987654444" }, payments: [{ status: "rejected", data: { rejectedAt: new Date(), reason: "Llamar al 987654321" } }] }), { stockDue: null }, null, context);
    expect(JSON.stringify({ ...full, enlace: "" })).not.toMatch(/\d{6}/);
    expect(full.pagos[0]!.motivo).toBe("Llamar al •••321");
  });
});
