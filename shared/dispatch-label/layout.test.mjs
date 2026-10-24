import assert from "node:assert/strict";
import test from "node:test";
import { layoutDispatchLabel } from "./layout.ts";

const profile = { widthPx: 732, heightPx: 1181, dpiX: 300, dpiY: 300 };
// Fixed-width fake font: 0.5em per character.
const measure = (text, sizePt) => Array.from(text).length * sizePt * 300 / 72 * 0.5;
const location = { department: "Lima", province: "Lima", district: "Miraflores" };
const base = { sender: { name: "Yoyos", phone: null }, orderNumber: 1042 };
const home = {
  ...base, scheduledDate: "2026-10-14", method: "home", courier: null,
  recipient: { name: "Ana Pérez", phone: "999111222", document: null },
  destination: { address: "Calle 2 123", location, reference: null },
};
const agency = {
  ...base, scheduledDate: null, method: "agency", courier: "Olva",
  recipient: { name: "Ana Pérez", phone: "999111222", document: { type: "national_id", number: "12345678" } },
  destination: { agencyName: "Olva Centro", address: "Av. 1", location },
};
const layout = (label, geometry = profile, typography) => layoutDispatchLabel(label, geometry, measure, typography);
const lines = (label) => {
  const result = layout(label);
  return result.success ? result.data.lines.map((line) => line.text) : result.error.code;
};

test("home label without reference or courier omits those lines and keeps the date in the footer", () => {
  const text = lines(home);
  assert.ok(!text.join("|").includes("Ref:"));
  assert.equal(text.at(-1), "Pedido #1042 · 14/10/2026");
});

test("agency label shows agency, document, courier and the order number without date", () => {
  const text = lines(agency);
  assert.ok(text.includes("DNI 12345678"));
  assert.ok(text.includes("Olva Centro"));
  assert.equal(text.at(-2), "Olva");
  assert.equal(text.at(-1), "Pedido #1042");
});

test("sender phone line is present only when a phone is set", () => {
  assert.deepEqual(lines(home).slice(0, 2), ["Yoyos", "Ana Pérez"]);
  const withPhone = lines({ ...home, sender: { name: "Yoyos", phone: " 977 000 111 " } });
  assert.deepEqual(withPhone.slice(0, 3), ["Yoyos", "Cel. 977 000 111", "Ana Pérez"]);
  assert.ok(!lines({ ...home, sender: { name: "Yoyos", phone: "  " } }).some((text) => text === "Cel. "));
});

test("order number line uses scale 1.0 and the courier line precedes it", () => {
  const result = layout(agency);
  assert.ok(result.success);
  const last = result.data.lines.at(-1);
  assert.equal(last.sizePt, result.data.sizePt);
  const courier = result.data.lines.at(-2);
  assert.ok(courier.sizePt > last.sizePt && courier.y < last.y);
});

test("order number is on home and agency labels", () => {
  assert.ok(lines(home).includes("Pedido #1042 · 14/10/2026"));
  assert.ok(lines(agency).includes("Pedido #1042"));
});

test("long names and destinations shrink the font without truncating", () => {
  const long = { ...home, recipient: { ...home.recipient, name: "María de los Ángeles Fernández de la Torre ".repeat(2).trim() },
    destination: { ...home.destination, address: "Avenida Los Libertadores de la Patria 1234 Urbanización Las Magnolias ".repeat(5).trim(), reference: "Frente al parque grande" } };
  const small = layout(home);
  const result = layout(long);
  assert.ok(result.success && small.success && result.data.sizePt < small.data.sizePt);
  const text = lines(long).join("");
  assert.ok(text.includes("Magnolias"));
  assert.ok(!text.includes("…"));
});

test("content that cannot fit even at the minimum size overflows", () => {
  assert.equal(lines({ ...home, destination: { ...home.destination, address: "Calle larga ".repeat(200) } }), "LABEL_CONTENT_OVERFLOW");
});

test("the extra sender and order lines can push a tight label into overflow", () => {
  const tight = { ...profile, heightPx: 1181 };
  const long = { ...home, destination: { ...home.destination, address: "Calle larga ".repeat(40) } };
  const fits = layout(long, tight);
  assert.ok(fits.success);
  assert.equal(layout(long, { ...tight, heightPx: 20 }).error.code, "LABEL_CONTENT_OVERFLOW");
});

test("typography at 12 pt down to 7 pt in 0.5 pt steps is the default", () => {
  const result = layout(home);
  assert.ok(result.success && result.data.sizePt === 12);
  assert.equal(layout(home, profile, { basePt: 6, minPt: 8, stepPt: 1 }).success, false);
  assert.equal(layout(home, profile, { basePt: 12, minPt: 7, stepPt: 0 }).success, false);
});

test("blank lines inside address or reference do not cause a false overflow", () => {
  const label = { ...home, destination: { ...home.destination, address: "Calle 2 123\n\nMz A", reference: "Puerta azul\n\nTocar timbre" } };
  assert.ok(lines(label).includes("Tocar timbre"));
});

test("the page geometry can be given in points for vector output", () => {
  const points = { widthPx: 62 * 72 / 25.4, heightPx: 100 * 72 / 25.4, dpiX: 72, dpiY: 72 };
  const pointsMeasure = (text, sizePt) => Array.from(text).length * sizePt * 0.5;
  assert.ok(layoutDispatchLabel(home, points, pointsMeasure).success);
});
