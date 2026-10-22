# Yoyos landing

Public landing of Yoyos: an independent [Astro](https://astro.build) package that compiles to static files (`dist/`): `/`, `/privacidad`, the 404, `robots.txt`, the sitemap and the web manifest. It ships no JavaScript except two optional modules (the demo-form enhancement and the analytics listener). Rules, decisions and contracts: [`docs/landing.md`](../docs/landing.md); literal copy: `src/content/`.

## Requirements

Node.js 24 and pnpm 12.5.1 (same as CI). The package has its own lockfile and no workspace with the apps.

```sh
pnpm --dir landing install --frozen-lockfile
```

## Commands

Run them from `landing/`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Astro dev server with hot reload. |
| `pnpm build` | Static production build into `dist/`. |
| `pnpm preview` | Serves `dist/` locally. |
| `pnpm lint` | ESLint (including Astro accessibility rules). |
| `pnpm typecheck` | `astro check` over `.astro` and `.ts` files. |
| `pnpm test` | Unit tests (Vitest project `unit`). |
| `pnpm test:build` | Builds two variants (`minimal` and `full`) with explicit variables and asserts on their `dist` (Vitest project `build-output`). |

To run it locally: `cp .env.example .env`, then `pnpm dev`, or `pnpm build && pnpm preview`.

## Configuration

Every contact value, URL and switch comes from `PUBLIC_*` environment variables, parsed once with Zod at build time (`src/config/site-config.ts`). An invalid or missing required value fails the build with `INVALID_SITE_CONFIG` and the names of the offending variables. Astro resolves `PUBLIC_*` variables **at build time**: rebuild after changing any of them.

| Variable | Required | Default when empty | Use |
| --- | --- | --- | --- |
| `PUBLIC_SITE_URL` | Yes | — | Absolute `https` origin without path (`http://localhost` only in `astro dev`). Canonical, hreflang, Open Graph, JSON-LD, sitemap and robots. |
| `PUBLIC_INDEXING` | No | `false` | `true`: `index, follow` and `robots.txt` allows crawling. `false`: every page carries `noindex, nofollow` and `robots.txt` disallows all. The 404 is always `noindex`. |
| `PUBLIC_WHATSAPP_NUMBER` | Yes | — | Digits only, country code without `+` (`wa.me` link). |
| `PUBLIC_WHATSAPP_DEMO_TEXT` | No | `wa.me` link without text | Text prefilled in the WhatsApp chat. |
| `PUBLIC_PHONE_NUMBER` | No | `+` and the WhatsApp number | International format for the `tel:` link and the JSON-LD telephone. |
| `PUBLIC_PHONE_DISPLAY` | No | The call number as is | Phone as shown on the page. |
| `PUBLIC_APP_LOGIN_URL` | No | «Ingresar» is not rendered | Link to the app login. |
| `PUBLIC_DEMO_FORM_ACTION` | No | Form, separator and every «Agenda una demo» button are not rendered | URL that receives the demo form `POST`. |
| `PUBLIC_CONTACT_EMAIL` | No | Not rendered | Footer, form notice, `/privacidad` and JSON-LD `email`. |
| `PUBLIC_TIKTOK_URL`, `PUBLIC_INSTAGRAM_URL` | No | Not rendered | Footer and JSON-LD `sameAs`. |
| `PUBLIC_ANALYTICS_ENABLED` | No | `false` | `true` loads the analytics listener, which forwards events to `window.yoyosAnalytics` if an adapter is installed. No analytics tool is installed by this package. |

`.env.example` documents each variable with an example value; the CI job copies it to `.env`.

## Structure

- `src/config/`: environment schema and the resolved `siteConfig` (pages never read `import.meta.env` directly).
- `src/lib/`: pure helpers (contact links, SEO, JSON-LD, manifest, analytics) with colocated tests.
- `src/content/`: literal copy, one module per section; components contain no copy.
- `src/styles/design-theme.ts`: the single token adapter. It builds CSS custom properties from `docs/design-tokens.json` (light values only; the landing has no dark mode); never copy token values into CSS.
- `src/layouts/`, `src/components/`, `src/pages/`: presentation.
- `assets-src/render-assets.mjs`: renders `public/icon-192.png`, `icon-512.png`, `logo-512.png` and `og/yoyos-1200x630.png` from the brand SVGs and `assets-src/og-image.svg` (`node assets-src/render-assets.mjs`).
- `public/_headers`: immutable cache headers for `/_astro/*`; applying them is the deployment task.

Internal imports use `@landing/*` (this package, from its root), `@docs/*` and `@shared/*` (`../docs`, `../shared`, read only; both shared files import nothing, so CI does not install `shared`).

## Text zoom check

Pages must reflow without horizontal page scroll at 360 px with the browser default font size at 200%. Measure it on `dist` (`pnpm build`, then serve it) with a Chromium CDP session: `Page.setFontSizes` with `{ fontSizes: { standard: 32 } }`, load `/`, `/privacidad` and the 404, and compare `document.documentElement.scrollWidth` with `clientWidth` (both must be 360). `src/styles/global.css` sets `overflow-wrap: anywhere` on headings, paragraphs, list items, summaries and pill labels so long words wrap instead of widening grid tracks; `tests/source/text-zoom.test.ts` guards that rule.

## Provisional assets

These are placeholders until the founder or Marketing supplies the real ones:

- The Open Graph image (`public/og/yoyos-1200x630.png`) is rendered from a committed SVG with a system font; Marketing must approve or replace it.
- Partner logos (Shalom, Olva, Yape, Plin) are not in the repository: they render as a provisional text badge until the official SVGs are added to `src/assets/logos/`.
- App screenshots are real (`src/assets/screenshots/`, wired as `kind: "image"` slots); a slot typed `provisional` still renders a box marked «Imagen provisional».
- Company data in `/privacidad` (bracketed placeholders), contact email and social URLs.

## Not covered here

Deployment, Cloudflare and DNS, the value of `PUBLIC_INDEXING` for the first domain, the CRM endpoint that receives the demo form, and the choice of an analytics tool are separate tasks.
