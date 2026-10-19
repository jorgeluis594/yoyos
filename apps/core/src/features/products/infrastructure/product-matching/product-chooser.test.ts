import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { buildChooserPrompt, parseChooserOutput, type ChooserInput } from "@core/src/features/products/infrastructure/product-matching/product-chooser";
import type { ProductId } from "@core/src/features/products/domain/product";

const png = async (width: number, height: number) => ({ bytes: new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#888" } }).png().toBuffer()), contentType: "image/png" });

async function input(count = 3): Promise<ChooserInput> {
  const image = await png(8, 8);
  return { query: image, candidates: Array.from({ length: count }, (_, n) => ({ productId: `product-${n}` as ProductId, image })) };
}

describe("product chooser", () => {
  test("labels candidates A, B, … in order and builds the prompt without product names", async () => {
    const prompt = await buildChooserPrompt(await input());
    expect(prompt.success && prompt.data.labels).toEqual(["A", "B", "C"]);
    const texts = prompt.success ? prompt.data.parts.flatMap((part) => part.kind === "text" ? [part.text] : ["<image>"]) : [];
    expect(texts).toEqual(["Customer image:", "<image>", "Candidate A:", "<image>", "Candidate B:", "<image>", "Candidate C:", "<image>"]);
    expect(JSON.stringify(prompt)).not.toContain("product-");
  });

  test("maps the chosen label back to its product id", async () => {
    expect(parseChooserOutput({ choice: "B", confidence: 0.85 }, await input(), ["A", "B", "C"]))
      .toEqual({ success: true, data: { kind: "product", productId: "product-1", confidence: 0.85 } });
  });

  test("maps none to a none choice", async () => {
    expect(parseChooserOutput({ choice: "none", confidence: 0.4 }, await input(), ["A", "B", "C"])).toEqual({ success: true, data: { kind: "none" } });
  });

  test("rejects an unknown label, a confidence outside 0 to 1, a missing field or extra fields as INVALID_MATCHER_RESPONSE", async () => {
    const outputs = [{ choice: "D", confidence: 0.9 }, { choice: "A", confidence: 1.2 }, { choice: "A" }, { choice: "A", confidence: 0.9, reason: "x" }, "A", null];
    for (const output of outputs) {
      expect(parseChooserOutput(output, await input(), ["A", "B", "C"])).toMatchObject({ success: false, error: { code: "INVALID_MATCHER_RESPONSE" } });
    }
  });

  test("resizes images larger than 1024 px before sending", async () => {
    const prompt = await buildChooserPrompt({ query: await png(3000, 1500), candidates: [{ productId: "p" as ProductId, image: await png(600, 400) }] });
    const images = prompt.success ? prompt.data.parts.flatMap((part) => part.kind === "image" ? [part.image] : []) : [];
    const sizes = await Promise.all(images.map(async ({ bytes, contentType }) => ({ contentType, ...await sharp(bytes).metadata() })));
    expect(sizes.map(({ width, height, contentType }) => [width, height, contentType])).toEqual([[1024, 512, "image/jpeg"], [600, 400, "image/jpeg"]]);
  });
});
