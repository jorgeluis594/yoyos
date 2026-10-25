import assert from "node:assert/strict";
import test from "node:test";
import { layoutDispatchLabel } from "./layout.ts";

const profile = { widthPx: 732, heightPx: 1181, dpiX: 300, dpiY: 300, paddingMm: 2 };
// Fixed-width fake font: 0.4em per character, bold 0.45em.
const measure = (text, sizePt, weight) => Array.from(text).length * sizePt * 300 / 72 * (weight === "bold" ? 0.45 : 0.4);
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
// Runs on the same baseline form one printed line.
const printed = (data) => {
  const rows = new Map();
  for (const run of data.lines) rows.set(run.y, [...rows.get(run.y) ?? [], run]);
  return [...rows.values()].map((runs) => ({ text: runs.map((run) => run.text).join(""), runs }));
};
const lines = (label, geometry) => {
  const result = layout(label, geometry);
  return result.success ? printed(result.data).map((line) => line.text) : result.error.code;
};
const weightOf = (label, text) => {
  const result = layout(label);
  assert.ok(result.success);
  return result.data.lines.find((run) => run.text === text)?.weight;
};

test("sections are headed in order and the footer has no heading", () => {
  const text = lines(home);
  const headings = ["REMITENTE", "DESTINATARIO", "ENTREGA A DOMICILIO"].map((heading) => text.indexOf(heading));
  assert.ok(headings.every((index, position) => index >= 0 && (position === 0 || index > headings[position - 1])));
  assert.equal(text[0], "REMITENTE");
  assert.ok(lines(agency).includes("RECOJO EN AGENCIA"));
  assert.equal(weightOf(home, "DESTINATARIO"), "bold");
});

test("full-width rules separate the sections and the footer, inside the padding", () => {
  const result = layout(home);
  assert.ok(result.success);
  const padding = 2 * 300 / 25.4;
  assert.equal(result.data.rules.length, 3);
  for (const rule of result.data.rules) {
    assert.ok(Math.abs(rule.x1 - padding) < 1e-9 && Math.abs(rule.x2 - (732 - padding)) < 1e-9);
    assert.ok(Math.abs(rule.thickness - 0.75 * 300 / 72) < 1e-9);
  }
  const headings = result.data.lines.filter((run) => ["DESTINATARIO", "ENTREGA A DOMICILIO"].includes(run.text));
  for (const [index, heading] of headings.entries()) assert.ok(result.data.rules[index].y < heading.y);
});

test("the footer is pinned to the bottom padding with the order number in bold", () => {
  const result = layout(home);
  assert.ok(result.success);
  const last = result.data.lines.at(-1);
  assert.equal(printed(result.data).at(-1).text, "Pedido #1042 · 14/10/2026");
  assert.ok(last.y > 1181 - 2 * 300 / 25.4 - last.sizePt * 300 / 72);
  assert.ok(result.data.rules.at(-1).y < last.y);
  assert.equal(weightOf(home, "Pedido #1042"), "bold");
  assert.equal(weightOf(home, "14/10/2026"), "regular");
});

test("agency label shows agency, document, courier and the order number without date", () => {
  const text = lines(agency);
  assert.ok(text.includes("Cel. 999111222 · DNI 12345678"));
  assert.ok(text.includes("Olva Centro"));
  assert.equal(weightOf(agency, "Olva Centro"), "bold");
  assert.deepEqual(text.slice(-2), ["Courier: Olva", "Pedido #1042"]);
});

test("location is uppercase, bold and district first", () => {
  assert.ok(lines(home).includes("MIRAFLORES · LIMA · LIMA"));
  assert.equal(weightOf(home, "MIRAFLORES"), "bold");
});

test("the recipient name is bold and the largest text", () => {
  const result = layout(home);
  assert.ok(result.success);
  const name = result.data.lines.find((run) => run.text === "Ana Pérez");
  assert.equal(name.weight, "bold");
  assert.ok(result.data.lines.every((run) => run.sizePt <= name.sizePt));
});

test("sender phone shares the line with the name only when a phone is set", () => {
  assert.equal(lines(home)[1], "Yoyos");
  const withPhone = lines({ ...home, sender: { name: "Yoyos", phone: " 977 000 111 " } });
  assert.equal(withPhone[1], "Yoyos · Cel. 977 000 111");
  assert.ok(!lines({ ...home, sender: { name: "Yoyos", phone: "  " } }).some((text) => text.includes("Cel. ") && text.endsWith("Cel. ")));
});

test("parts that do not fit together break at the separator", () => {
  const narrow = { ...profile, widthPx: 500 };
  const text = lines({ ...home, sender: { name: "Fantastidog Demo", phone: "977 000 111" } }, narrow);
  assert.deepEqual(text.slice(1, 3), ["Fantastidog Demo", "Cel. 977 000 111"]);
});

test("runs on one line are placed left to right without overlapping", () => {
  const result = layout({ ...home, sender: { name: "Yoyos", phone: "977" } });
  assert.ok(result.success);
  const [line] = printed(result.data).filter((row) => row.text === "Yoyos · Cel. 977");
  for (let index = 1; index < line.runs.length; index++) {
    const previous = line.runs[index - 1];
    assert.ok(Math.abs(line.runs[index].x - (previous.x + measure(previous.text, previous.sizePt, previous.weight))) < 1e-9);
  }
});

test("long names and destinations shrink the font without truncating", () => {
  const long = { ...home, recipient: { ...home.recipient, name: "María de los Ángeles Fernández de la Torre ".repeat(2).trim() },
    destination: { ...home.destination, address: "Avenida Los Libertadores de la Patria 1234 Urbanización Las Magnolias ".repeat(4).trim(), reference: "Frente al parque grande" } };
  const small = layout(home);
  const result = layout(long);
  assert.ok(result.success && small.success && result.data.sizePt < small.data.sizePt);
  const text = lines(long).join("");
  assert.ok(text.includes("Magnolias"));
  assert.ok(!text.includes("…"));
});

test("content that cannot fit even at the minimum size overflows", () => {
  assert.equal(lines({ ...home, destination: { ...home.destination, address: "Calle larga ".repeat(200) } }), "LABEL_CONTENT_OVERFLOW");
  assert.equal(lines(home, { ...profile, heightPx: 20 }), "LABEL_CONTENT_OVERFLOW");
});

test("typography at 12 pt down to 7 pt in 0.5 pt steps is the default", () => {
  const result = layout(home);
  assert.ok(result.success && result.data.sizePt === 12);
  assert.equal(layout(home, profile, { basePt: 6, minPt: 8, stepPt: 1 }).success, false);
  assert.equal(layout(home, profile, { basePt: 12, minPt: 7, stepPt: 0 }).success, false);
});

test("a larger padding narrows the text column", () => {
  const result = layout(home, { ...profile, paddingMm: 6 });
  assert.ok(result.success);
  assert.ok(result.data.lines.every((run) => run.x >= 6 * 300 / 25.4 - 1e-9));
});

test("blank lines inside address or reference do not cause a false overflow", () => {
  const label = { ...home, destination: { ...home.destination, address: "Calle 2 123\n\nMz A", reference: "Puerta azul\n\nTocar timbre" } };
  assert.ok(lines(label).includes("Tocar timbre"));
});

test("the page geometry can be given in points for vector output", () => {
  const points = { widthPx: 62 * 72 / 25.4, heightPx: 100 * 72 / 25.4, dpiX: 72, dpiY: 72, paddingMm: 2 };
  const pointsMeasure = (text, sizePt, weight) => Array.from(text).length * sizePt * (weight === "bold" ? 0.45 : 0.4);
  assert.ok(layoutDispatchLabel(home, points, pointsMeasure).success);
});

const withName = (name) => lines({ ...home, recipient: { ...home.recipient, name } });
const withAddress = (address) => lines({ ...home, destination: { ...home.destination, address } });

test("a name wraps at the space instead of inside a word", () => {
  const text = withName("Jorge Gonzalez Ramírez Fernández");
  const start = text.indexOf("DESTINATARIO") + 1;
  assert.ok(text.slice(start, start + 2).every((line) => line.split(" ").every((word) => "Jorge Gonzalez Ramírez Fernández".split(" ").includes(word))));
});

test("addresses never split a word that fits on a line", () => {
  const text = withAddress("Mz. B Lote 4 Urbanización Las Magnolias y Los Cedros 1234");
  for (const word of ["Mz.", "Lote", "Magnolias", "Cedros"]) assert.ok(text.some((line) => line.split(" ").includes(word)), word);
});

test("a word longer than the line splits by character without hyphen and the next word follows the last fragment", () => {
  const result = layout({ ...home, destination: { ...home.destination, address: "Av. " + "x".repeat(40) + " Sur" } }, { ...profile, heightPx: 3000 });
  assert.ok(result.success);
  const text = printed(result.data).map((line) => line.text);
  const start = text.indexOf("Av.");
  assert.ok(start >= 0);
  const fragments = text.slice(start + 1, text.findIndex((line) => line.endsWith(" Sur")) + 1);
  assert.ok(fragments.length >= 2);
  assert.equal(fragments.join("").replace(" Sur", ""), "x".repeat(40));
  assert.ok(fragments.every((line) => !line.includes("-")));
  assert.ok(fragments.at(-1).endsWith(" Sur"));
});

test("an explicit newline still forces a break", () => {
  assert.ok(withAddress("Mz A\nLote 4").join("|").includes("Mz A|Lote 4"));
});

test("no line starts or ends with a space", () => {
  const text = withAddress("Calle   larga   número  " + "palabra ".repeat(12)).concat(withName("Jorge  Gonzalez   Ramírez"));
  assert.ok(text.every((line) => line === line.trim() && line.length > 0));
});
