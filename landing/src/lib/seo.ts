import type { SiteUrl } from "@landing/src/config/site-config";

export type PagePath = "/" | `/${string}`;

export type PageSeo = Readonly<{
  path: PagePath;
  title: string;
  description: string;
  socialTitle: string;
  twitterTitle: string;
  twitterDescription: string;
  image: Readonly<{ path: `/${string}`; alt: string; width: number; height: number }>;
  indexable: boolean;
}>;

export function robotsMeta(
  indexing: boolean,
  page: Pick<PageSeo, "indexable">,
): "index, follow" | "noindex, nofollow" {
  return indexing && page.indexable ? "index, follow" : "noindex, nofollow";
}

export function canonicalUrl(siteUrl: SiteUrl, path: PagePath): string {
  return path === "/" ? `${siteUrl}/` : `${siteUrl}${path}`;
}

export function buildRobotsTxt(input: Readonly<{ indexing: boolean; siteUrl: SiteUrl }>): string {
  if (!input.indexing) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nSitemap: ${input.siteUrl}/sitemap-index.xml\n`;
}
