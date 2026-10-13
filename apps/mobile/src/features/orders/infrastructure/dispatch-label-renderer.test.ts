import type { DispatchLabel } from "@mobile/features/orders/domain/dispatch-label";
import { layoutDispatchLabel } from "@mobile/features/orders/infrastructure/dispatch-label-renderer";

jest.mock("@shopify/react-native-skia", () => ({ Skia: {} }));
jest.mock("expo-asset", () => ({ Asset: {} }));
jest.mock("expo-crypto", () => ({}));
jest.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));

const profile = { widthPx: 732, heightPx: 1181, dpiX: 300, dpiY: 300 };
// Fixed-width fake font: 0.5em per character.
const measure = (text: string, sizePt: number) => Array.from(text).length * sizePt * 300 / 72 * 0.5;
const location = { department: "Lima", province: "Lima", district: "Miraflores" };
const home: DispatchLabel = {
  sender: "Yoyos", scheduledDate: "2026-10-14", method: "home", courier: null,
  recipient: { name: "Ana Pérez", phone: "999111222", document: null },
  destination: { address: "Calle 2 123", location, reference: null },
};
const agency: DispatchLabel = {
  sender: "Yoyos", scheduledDate: null, method: "agency", courier: "Olva",
  recipient: { name: "Ana Pérez", phone: "999111222", document: { type: "national_id", number: "12345678" } },
  destination: { agencyName: "Olva Centro", address: "Av. 1", location },
};
const texts = (label: DispatchLabel) => {
  const result = layoutDispatchLabel(label, profile, measure);
  return result.success ? result.data.lines.map((line) => line.text).join("|") : result.error.code;
};

test("home label without reference or courier omits those lines and keeps the date", () => {
  const text = texts(home);
  expect(text).not.toContain("Ref:");
  expect(text).toContain("14/10/2026");
});

test("agency label without date shows agency, document and courier only", () => {
  const text = texts(agency);
  expect(text).toContain("Olva Centro");
  expect(text).toContain("DNI 12345678");
  expect(text).toContain("Olva");
  expect(text).not.toContain("/");
});

test("long names and destinations shrink the font without truncating", () => {
  const long = { ...home, recipient: { ...home.recipient, name: "María de los Ángeles Fernández de la Torre ".repeat(2).trim() },
    destination: { ...home.destination, address: "Avenida Los Libertadores de la Patria 1234 Urbanización Las Magnolias ".repeat(5).trim(), reference: "Frente al parque grande" } };
  const base = layoutDispatchLabel(home, profile, measure);
  const result = layoutDispatchLabel(long, profile, measure);
  expect(result.success && base.success && result.data.sizePt < base.data.sizePt).toBe(true);
  expect(texts(long).replace(/\|/g, "")).toContain("Magnolias");
  expect(texts(long)).not.toContain("…");
});

test("content that cannot fit even at the minimum size overflows", () => {
  const huge = { ...home, destination: { ...home.destination, address: "Calle larga ".repeat(200) } };
  expect(texts(huge)).toBe("LABEL_CONTENT_OVERFLOW");
});

test("a minimum size above the base cannot fit anything and overflows", () => {
  expect(layoutDispatchLabel(home, profile, measure, { basePt: 6, minPt: 8, stepPt: 1 })).toMatchObject({ success: false, error: { code: "LABEL_CONTENT_OVERFLOW" } });
});
