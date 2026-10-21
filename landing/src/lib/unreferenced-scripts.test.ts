import { describe, expect, test } from "vitest";
import { findUnreferencedScripts } from "./unreferenced-scripts";

const page = (...tags: string[]) => `<html><body>${tags.join("")}</body></html>`;

describe("findUnreferencedScripts", () => {
  test("returns every script when no page loads one", () => {
    expect(findUnreferencedScripts([page("<p>hola</p>")], { "_astro/a.js": "", "_astro/b.js": "" })).toEqual(["_astro/a.js", "_astro/b.js"]);
  });

  test("keeps scripts referenced through script src", () => {
    const pages = [page('<script type="module" src="/_astro/a.js"></script>')];
    expect(findUnreferencedScripts(pages, { "_astro/a.js": "", "_astro/b.js": "" })).toEqual(["_astro/b.js"]);
  });

  test("keeps chunks imported statically, dynamically and across directories", () => {
    const pages = [page('<script type="module" src="/_astro/a.js"></script>')];
    const scripts = {
      "_astro/a.js": 'import{x}from"./b.js";import("./c.js");',
      "_astro/b.js": 'export*from"../_astro/d.js";',
      "_astro/c.js": "",
      "_astro/d.js": "",
      "_astro/e.js": 'import "./a.js";',
    };
    expect(findUnreferencedScripts(pages, scripts)).toEqual(["_astro/e.js"]);
  });

  test("follows imports of inline module scripts and ignores query strings", () => {
    const pages = [page('<script type="module">import "/_astro/a.js?v=1";</script>')];
    expect(findUnreferencedScripts(pages, { "_astro/a.js": "", "_astro/b.js": "" })).toEqual(["_astro/b.js"]);
  });

  test("handles import cycles and unknown specifiers", () => {
    const pages = [page('<script src="/_astro/a.js"></script>')];
    const scripts = { "_astro/a.js": 'import "./b.js";import "https://cdn.test/x.js";', "_astro/b.js": 'import "./a.js";' };
    expect(findUnreferencedScripts(pages, scripts)).toEqual([]);
  });

  test("counts a script referenced by any page", () => {
    const pages = [page(), page('<script src="/_astro/a.js"></script>')];
    expect(findUnreferencedScripts(pages, { "_astro/a.js": "" })).toEqual([]);
  });
});
