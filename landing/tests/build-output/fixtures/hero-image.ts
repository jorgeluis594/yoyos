import type { ScreenshotSlot } from "@landing/src/content/sections/screenshot-slot";
import image from "./hero-fixture.png";

/** Stands in for src/content/sections/hero-image.ts in hero-image.test.ts: the hero slot as a real image. */
export const heroImage: ScreenshotSlot = { kind: "image", image, aspectRatio: "4/5", alt: "Captura de prueba del hero" };
