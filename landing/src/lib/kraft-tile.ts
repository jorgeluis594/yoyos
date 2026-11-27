import { getImage } from "astro:assets";
import kraft from "@landing/src/assets/plates/kraft.png";

/** URL of the seamless kraft paper tile that the header, the hero and the first section repeat as background. */
export async function kraftTileUrl(): Promise<string> {
  const tile = await getImage({ src: kraft, format: "webp", width: 640, quality: 55 });
  return tile.src;
}
