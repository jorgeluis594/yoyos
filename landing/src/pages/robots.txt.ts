import type { APIRoute } from "astro";
import { siteConfig } from "@landing/src/config/site";
import { buildRobotsTxt } from "@landing/src/lib/seo";

export const GET: APIRoute = () =>
  new Response(buildRobotsTxt({ indexing: siteConfig.indexing, siteUrl: siteConfig.siteUrl }), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
