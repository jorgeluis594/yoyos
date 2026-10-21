import type { APIRoute } from "astro";
import { buildManifest } from "@landing/src/lib/manifest";
import { designTokens } from "@landing/src/styles/design-theme";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildManifest(designTokens)), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
  });
