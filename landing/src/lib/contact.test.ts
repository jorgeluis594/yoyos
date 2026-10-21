import { describe, expect, test } from "vitest";
import { telUrl, whatsappUrl } from "@landing/src/lib/contact";
import type { CallNumber, WhatsappNumber } from "@landing/src/config/site-config";

const number = "51977909427" as WhatsappNumber;

describe("contact links", () => {
  test("builds the wa.me link with the demo text URL-encoded", () => {
    expect(whatsappUrl({ number, demoText: "Hola, quiero una demo de Yoyos" })).toBe(
      "https://wa.me/51977909427?text=Hola%2C%20quiero%20una%20demo%20de%20Yoyos",
    );
  });

  test("builds the wa.me link without text when the demo text is absent", () => {
    expect(whatsappUrl({ number, demoText: null })).toBe("https://wa.me/51977909427");
  });

  test("builds the tel link from the international call number", () => {
    expect(telUrl({ number: "+51977909427" as CallNumber, display: "+51 977 909 427" })).toBe("tel:+51977909427");
  });
});
