import { describe, expect, test } from "vitest";
import type { SiteUrl } from "@landing/src/config/site-config";
import { buildRobotsTxt, canonicalUrl, robotsMeta } from "@landing/src/lib/seo";

const siteUrl = "https://landing.yoyos.lat" as SiteUrl;

describe("seo helpers", () => {
  test("returns noindex, nofollow when indexing is off and index, follow when it is on", () => {
    expect(robotsMeta(false, { indexable: true })).toBe("noindex, nofollow");
    expect(robotsMeta(true, { indexable: true })).toBe("index, follow");
  });

  test("returns noindex, nofollow for a non-indexable page even when indexing is on", () => {
    expect(robotsMeta(true, { indexable: false })).toBe("noindex, nofollow");
  });

  test("builds the home canonical with a slash and subpage canonicals without one", () => {
    expect(canonicalUrl(siteUrl, "/")).toBe("https://landing.yoyos.lat/");
    expect(canonicalUrl(siteUrl, "/privacidad")).toBe("https://landing.yoyos.lat/privacidad");
  });

  test("allows crawling and points to the sitemap index when indexing is on", () => {
    expect(buildRobotsTxt({ indexing: true, siteUrl })).toBe(
      "User-agent: *\nAllow: /\nSitemap: https://landing.yoyos.lat/sitemap-index.xml\n",
    );
  });

  test("disallows all crawling and omits the sitemap line when indexing is off", () => {
    expect(buildRobotsTxt({ indexing: false, siteUrl })).toBe("User-agent: *\nDisallow: /\n");
  });
});
