import { describe, expect, test } from "vitest";
import type { CallNumber, SiteConfig, SiteUrl, WhatsappNumber } from "@landing/src/config/site-config";
import { faqEntries } from "@landing/src/content/faq";
import { buildHomeStructuredData, serializeJsonLd } from "@landing/src/lib/json-ld";
import fixture from "@landing/src/lib/json-ld.fixture.json";

const config: SiteConfig = {
  siteUrl: "https://landing.yoyos.lat" as SiteUrl,
  indexing: false,
  whatsapp: { number: "51977909427" as WhatsappNumber, demoText: "Hola, quiero una demo de Yoyos" },
  phone: { number: "+51977909427" as CallNumber, display: "+51 977 909 427" },
  appLoginUrl: null,
  demoForm: { kind: "disabled" },
  contactEmail: null,
  social: { tiktok: null, instagram: null },
  analyticsEnabled: false,
};

type Node = Record<string, unknown>;

function node(type: string, graph = buildHomeStructuredData(config, faqEntries)): Node {
  const found = graph["@graph"].find((item) => item["@type"] === type);
  if (!found) throw new Error(`missing ${type}`);
  return found;
}

describe("buildHomeStructuredData", () => {
  test("matches the approved JSON-LD graph for the example configuration", () => {
    expect(JSON.parse(serializeJsonLd(buildHomeStructuredData(config, faqEntries)))).toEqual(fixture);
  });

  test("includes the ten published questions in FAQPage and leaves out question 6", () => {
    const questions = node("FAQPage")["mainEntity"] as Node[];
    expect(questions).toHaveLength(10);
    expect(questions.map((question) => question["name"])).not.toContain("¿Qué pasa con mis datos y los de mis clientes?");
  });

  test("adds email to Organization only when the contact email is set", () => {
    expect(node("Organization")).not.toHaveProperty("email");
    const withEmail = buildHomeStructuredData({ ...config, contactEmail: "hola@example.test" }, faqEntries);
    expect(node("Organization", withEmail)["email"]).toBe("hola@example.test");
  });

  test("adds sameAs with only the configured social URLs and omits it when none is set", () => {
    expect(node("Organization")).not.toHaveProperty("sameAs");
    const withTiktok = buildHomeStructuredData(
      { ...config, social: { tiktok: "https://www.tiktok.com/@example", instagram: null } },
      faqEntries,
    );
    expect(node("Organization", withTiktok)["sameAs"]).toEqual(["https://www.tiktok.com/@example"]);
  });

  test("uses the call number as the contact point telephone", () => {
    const withPhone = buildHomeStructuredData({ ...config, phone: { number: "+51912345678" as CallNumber, display: "x" } }, faqEntries);
    expect((node("Organization", withPhone)["contactPoint"] as Node)["telephone"]).toBe("+51912345678");
  });

  test("escapes the less-than sign so the JSON cannot close the script tag", () => {
    expect(serializeJsonLd(buildHomeStructuredData(config, [{ number: 1, question: "</script>", visibility: "published", answer: "a" }]))).not.toContain("<");
  });
});
