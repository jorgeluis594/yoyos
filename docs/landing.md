# Landing

The public landing of Yoyos explains the product to sellers who sell through social media in Peru and leads them to write to sales on WhatsApp, call, or request a demo. It is a static site in Spanish (`es-PE`) with three pages: `/`, `/privacidad` and the 404, plus `robots.txt`, the sitemap and the web manifest.

Code: `landing/` (independent Astro package; how to install, run, build and test it is in [`landing/README.md`](../landing/README.md)). Brand rules: the "Landing" recipe in [`DESIGN.md`](../DESIGN.md) and the tokens in [`design-tokens.json`](design-tokens.json).

## Content

The literal copy approved by the founder and Marketing lives once, in typed modules under `landing/src/content/`, and is the source of truth for every text on the pages. Components contain no copy. Changing a text means changing that module; this document holds the rules the copy must follow, not the copy itself.

| Content | Location |
| --- | --- |
| Navigation, header, footer, CTA labels, page metadata (title, description, Open Graph, Twitter) of `/`, `/privacidad` and the 404 | `landing/src/content/site.ts` |
| Home sections (hero, value strip, problem, benefits, how it works, features, integrations, testimonials, pricing, final CTA) | `landing/src/content/sections/*.ts` |
| FAQ questions, answers and visibility | `landing/src/content/faq.ts` |
| Demo form labels, placeholders, options, error, success and notice texts | `landing/src/content/demo-form.ts` (contract values in `demo-form-values.ts`) |
| 404 page | `landing/src/content/not-found.ts` |
| Privacy policy prose | `landing/src/content/privacy-policy.astro` |
| Approved JSON-LD graph for the example configuration | `landing/src/lib/json-ld.fixture.json` |
| Open Graph image text and layout | `landing/assets-src/og-image.svg` |

### Copy rules

These rules are non-negotiable for any new or changed text, metadata, Open Graph or JSON-LD:

- **Photos only.** The only promise is that the order is built when the customer sends the photo of the product. No text promises orders from text messages, and no text states that as a limitation either.
- **Nothing unimplemented.** What is not implemented is neither promised nor written as a limitation.
- **No competitors** are named. Never "gratis", "prueba", "piloto" or "acceso anticipado"; there is no free trial or pilot.
- **Price:** «S/ 50 al mes + IGV», monthly subscription, a single plan, no commission per sale, no one-time payments, with the note «Los precios no incluyen IGV.».
- **Platforms:** «Disponible para Android. iPhone próximamente.» The iPhone is never denied and the App Store is never mentioned.
- **One seller.** Always address the seller in singular, informal Peruvian Spanish (tú). Never "equipo", "roles" or "varios vendedores".
- **Forbidden wording:** the word «oficial»; "partner de Meta", "sin riesgo", "100 % seguro", "tu número nunca será bloqueado"; absolutes such as "cualquier mensaje" or "sin copiar un solo dato"; promises about audio, photo captions, sizes or groups.
- **No claims either way** about: linking WhatsApp with a single phone, WhatsApp Business, blue ticks, delivery cost before payment, Android distribution, `noindex` of the app, visual search in production.
- **The seller shares** the checkout link; the customer does not receive it from Yoyos.
- **Labels:** «Imprime los rótulos de tus envíos en lote desde la app», without printer models. The label does not replace the courier's guide.
- No start-up time figures, no invented testimonials or metrics, no customer logos or invented social proof.
- The WhatsApp brand appears as text or a generic chat icon: its logo is not authorized. Shalom, Olva, Yape and Plin logos are authorized by the founder and live in `landing/src/assets/logos/` (Shalom and Plin PNG, Olva and Yape SVG, never recolored), with the trademark notice «WhatsApp, Shalom, Olva, Yape y Plin son marcas de sus respectivos dueños.» (the integrations section adds «Yoyos no está afiliado a ellas.»).

### Visibility rules

| Element | Rule |
| --- | --- |
| FAQ | Questions 1–5 and 7–11 are published, as native `<details>` with the question as H3. Question 6 («¿Qué pasa con mis datos y los de mis clientes?») is a hidden entry without answer: not rendered and not in the JSON-LD. Reason: its answer depends on the app's data policy, while `/privacidad` covers only the landing form. |
| Testimonials (`#testimonios`) | Not rendered while there are no real testimonials with permission. Each testimonial has quote, name, business, category, city and photo, without metrics. |
| «Ingresar» (header and footer) | Rendered only when `PUBLIC_APP_LOGIN_URL` is set. |
| Demo form | Rendered only when `PUBLIC_DEMO_FORM_ACTION` is set, together with the separator «o agenda una demo» and every «Agenda una demo» button (hero and pricing). Without it the final CTA keeps only WhatsApp and the call. |
| Contact email, TikTok, Instagram | Each is rendered only when its variable is set. Without an email, the form notice says only «escribiéndonos por WhatsApp» and `/privacidad` keeps the placeholder «[CORREO]». |
| Terms and conditions, Libro de Reclamaciones | Absent from the footer until their pages exist; they are added as content, not as variables. |
| Footer legal line | «© 2026 Yoyos. Hecho en Perú.», without company name, RUC or opening hours. |
| Section pill labels | Only sections reached from the navigation carry one, reusing the literal navigation label; the hero carries its eyebrow. Reason: the content defines no other labels and no copy is invented. |

### Page structure

The home is, in order: `#inicio` (hero, the only H1), the value strip (three items, no H2), `#problema`, `#beneficios`, `#como-funciona` (five H3 steps), `#funciones` (six H3 cards), `#integraciones`, `#testimonios` (hidden), `#precio` (one featured card, no monthly/annual switch), `#preguntas` and `#demo` (final CTA with the form as H3). The navigation anchors are `#como-funciona`, `#funciones`, `#integraciones`, `#precio` and `#preguntas`. `/privacidad` has its own H1 and its twelve numbered sections as H2. Every page has exactly one H1 and no skipped heading level.

## Privacy policy

`/privacidad` holds the policy approved by the founder for the demo form only (Ley N.º 29733 and its Reglamento, D. S. N.º 016-2024-JUS). It uses the landing layout, is in the sitemap and the footer, and the form's consent checkbox links to it in a new tab.

- Bracketed uppercase values are placeholders kept visible until filled: `[FECHA DE PUBLICACIÓN]`, `[RAZÓN SOCIAL]`, `[RUC]`, `[DOMICILIO]`, `[CORREO]`, `[UBICACIÓN DEL SERVIDOR DEL CRM]`, `[PROVEEDOR DE ALOJAMIENTO DE LA WEB]`, `[PAÍSES DE LOS SERVIDORES]`, `[NOMBRE DEL BANCO DE DATOS]`, `[CÓDIGO DE INSCRIPCIÓN]`.
- `[CORREO]` is replaced by `PUBLIC_CONTACT_EMAIL` when set; the WhatsApp number shown is `PUBLIC_PHONE_DISPLAY`.
- `/privacidad` is published in production with its placeholders still visible (founder decision, 2026-10-22); they are filled after the founder's final review.
- Any change to the policy text changes `consent_text_version` of the demo form.
- Choosing an analytics tool that uses cookies requires a consent notice and an update of section 10 («Cookies y analítica») of the policy.

## Configuration

Every contact value, URL and switch comes from `PUBLIC_*` variables, parsed once with Zod at build time into one site configuration; pages never read the environment directly. An invalid or missing required value fails the build with `INVALID_SITE_CONFIG` naming every offending variable. Reason: a static site has no runtime to report a misconfiguration, so the build is the only boundary. The variables are resolved at build time, so changing one requires a rebuild. `landing/.env.example` documents each with an example value. No phone number or site domain is written in source code.

| Variable | Required | When empty | Rule and use |
| --- | --- | --- | --- |
| `PUBLIC_SITE_URL` | Yes | — | Absolute `https` origin with no path, query or fragment; a trailing slash is removed. `http://localhost` is accepted only in `astro dev`. Canonical, hreflang, Open Graph, JSON-LD, sitemap and robots. |
| `PUBLIC_INDEXING` | No | `false` | Only `true` or `false`. Reason for the default: an unconfigured build is never indexable. Production at `yoyos.lat` builds with `true` (founder decision, 2026-10-22). |
| `PUBLIC_WHATSAPP_NUMBER` | Yes | — | Digits only, country code without `+` (8–15 digits), for the `wa.me` link. |
| `PUBLIC_WHATSAPP_DEMO_TEXT` | No | `wa.me` link without text | Prefilled chat text, URL-encoded. |
| `PUBLIC_PHONE_NUMBER` | No | `+` and the WhatsApp number | International format (`internationalPhonePattern` of `shared/phone.ts`) for the `tel:` link and the JSON-LD `telephone`. |
| `PUBLIC_PHONE_DISPLAY` | No | The call number as is | Number shown on the page, in `/privacidad` and in the «Llámanos» aria-label. |
| `PUBLIC_APP_LOGIN_URL` | No | «Ingresar» hidden | App login link. |
| `PUBLIC_DEMO_FORM_ACTION` | No | Form hidden (see visibility rules) | URL that receives the demo form `POST`. |
| `PUBLIC_CONTACT_EMAIL` | No | Hidden | Footer, form notice, `/privacidad` and JSON-LD `email`. |
| `PUBLIC_TIKTOK_URL`, `PUBLIC_INSTAGRAM_URL` | No | Hidden | `https` URLs for the footer and JSON-LD `sameAs`. |
| `PUBLIC_ANALYTICS_ENABLED` | No | `false` | `true` loads the analytics listener. |

Astro's `astro:env` schema is not used. Reason: it validates fields one by one, not the cross-field defaults (call number from WhatsApp) nor the hidden-when-empty variants, so it would be a second validator at the same boundary.

## SEO

- Every page has `lang="es-PE"`, its own title and description, a self-referencing canonical without query parameters (`{SITE}/` for the home, `{SITE}/privacidad` without slash for subpages), hreflang `es-PE` and `x-default` to the same URL, Open Graph (`website`, `es_PE`, site name «Yoyos») and Twitter `summary_large_image` tags, both `theme-color` metas from the token background colors, favicon, apple-touch-icon and manifest.
- **Indexing:** with `PUBLIC_INDEXING=true` pages carry `index, follow` and `robots.txt` allows all and names `{SITE}/sitemap-index.xml`; with `false` every page carries `noindex, nofollow` and `robots.txt` is `Disallow: /` with no sitemap line. The 404 is always `noindex, nofollow`.
- **Sitemap:** `/sitemap-index.xml` lists `/` and `/privacidad`, never the 404, and is generated in both indexing modes.
- **Open Graph image:** `public/og/yoyos-1200x630.png` (1200×630, under 300 KB) with «Tus pedidos de WhatsApp, en orden» and the logo, rendered from `assets-src/og-image.svg` by `assets-src/render-assets.mjs`, which also renders the 192/512 icons and the JSON-LD logo.
- **JSON-LD (home only):** one `@graph` with `Organization` (sales `ContactPoint` with the call number, `areaServed` PE, language es), `WebSite`, `SoftwareApplication` and `FAQPage`. Rules:
  - `FAQPage` is built from the same module as the visible FAQ, so its texts equal the page by construction; it holds only the published questions.
  - The offer is 50.00 PEN as a monthly `UnitPriceSpecification` with `valueAddedTaxIncluded: false`, matching «S/ 50 al mes + IGV». No `aggregateRating` or `review`. The description speaks of photos.
  - `operatingSystem` is `"Android"`; it becomes `"Android, iOS"` when the iPhone app is published.
  - `email` is added to `Organization` only when the contact email is set; `sameAs` only with the configured social URLs.
  - It is serialized with `<` escaped so the JSON cannot close its script element. It has no Zod schema: nothing in Yoyos parses it.
- Future SEO content (use-case pages or a blog) goes in the landing, not under the app's domain.

## Demo form contract

The «Agenda una demo» form and the endpoint that creates the lead in the CRM (Todoist 6hphgH8GpgFhjvgV) meet on this HTML form contract. The landing renders it; the endpoint validates it with its own schema and only adds behavior. Field names and option values are defined once in `landing/src/content/demo-form-values.ts` and `demo-form.ts`; no schema goes to `shared/contracts` because the landing exchanges no JSON.

| Aspect | Contract |
| --- | --- |
| Request | `POST {PUBLIC_DEMO_FORM_ACTION}`, `application/x-www-form-urlencoded`, UTF-8. Native navigation, no `fetch`, no CORS. Reason: it works without JavaScript. |
| `nombre` | Required, trimmed, 1–100 characters; a name made only of spaces is invalid. |
| `telefono` | Required. 9 national digits starting with 9, with an optional single space between the 3-3-3 groups (`9XX XXX XXX`). The visible prefix «+51» is not part of the value. With JavaScript the spaces are removed before sending; without it the value is sent as typed. The endpoint removes spaces, validates `^9\d{8}$` and stores `+51` followed by the digits. |
| `rubro` | Required: `ropa`, `zapatillas`, `joyeria_accesorios`, `mascotas`, `cosmeticos` or `otro`. |
| `contacto_preferido` | Required: `whatsapp` (checked by default) or `llamada`. |
| `consentimiento` | Required checkbox, unchecked by default, value `acepto`; absent means no consent. |
| `consent_text_version` | Hidden, `privacidad-v1-2026-10`; changes when the privacy text changes. |
| `website` | Honeypot, kept off-screen (not `display: none`), must be empty. If filled, the endpoint creates no lead and still answers success. |
| Consent time | Recorded by the endpoint at reception with the server clock; the form sends no timestamp. |
| Success | `303 See Other` to `{landing URL}/?demo=ok#demo-ok-whatsapp` or `#demo-ok-llamada`, matching `contacto_preferido`. |
| Failure (validation or technical) | `303 See Other` to `{landing URL}/?demo=error#demo-error`. |
| Return URL | Configuration of the endpoint. The form sends no return URL, so the endpoint cannot be used as an open redirect. |

The page shows the outcome without JavaScript: each fragment targets a message block that CSS `:target` reveals, and on success `:has()` hides the form. Reason: the confirmation must work with native POST and no script. If the endpoint does not answer with these redirects, the form shows no confirmation.

In the browser:

- Without JavaScript, the browser's own HTML validation blocks an invalid submit.
- With JavaScript, an enhancement module disables native validation, shows each field's literal error under it (`aria-describedby`, `aria-invalid`), focuses the first invalid field, changes the button to «Enviando…» on a valid submit and ignores repeated submits. The button stays enabled. Returning from the back/forward cache restores the button label. The module carries no copy and no personal data and stays within 2 KB, counting the chunks it imports.

## Analytics

Every CTA renders inert `data-event` and `data-location` attributes. With `PUBLIC_ANALYTICS_ENABLED=true` one listener builds typed events and forwards them to `window.yoyosAnalytics.track(name, props)` if an adapter is installed; otherwise nothing is sent. No tool is installed. Choosing one requires the founder's OK; it must be lightweight and cookieless, and nothing that costs money is activated without approval.

| Event | Trigger | Props | Locations |
| --- | --- | --- | --- |
| `whatsapp_click` | Any «Escríbenos por WhatsApp» link (opens in a new tab) | `location` | `header`, `hero`, `precio`, `cta_final`, `footer`, `404` |
| `call_click` | «Llámanos» `tel:` links | `location` | `header`, `hero`, `cta_final`, `footer` |
| `demo_form_open` | «Agenda una demo» links to `#demo` | `location` | `hero`, `precio` |
| `demo_form_submit` | Valid submit | `rubro`, `contacto_preferido` | `cta_final` |
| `demo_form_error` | Client validation failure (`reason: validation`) or page loaded on `#demo-error` (`reason: server`) | `reason` | `cta_final` |
| `faq_open` | A FAQ `<details>` opens (once per open) | `q` (question number) | `faq` |

Events have fixed names and props. No event or log carries the name, phone, free text, the form payload, the IP or any identifier.

## Architecture decisions

| Decision | Reason |
| --- | --- |
| `landing/` at the repository root, beside `apps/` and `shared/`, not `apps/landing` | Founder's decision: the landing is a separate module of the monorepo. |
| Independent package with its own `package.json`, lockfile and single-package `pnpm-workspace.yaml` | Same pattern as `apps/core` and `apps/mobile`; there is no root workspace, and the landing builds and deploys alone. |
| Astro, `output: 'static'`, `trailingSlash: 'never'`, `build.format: 'file'`, inlined stylesheets | Fast, indexable static pages; `file` format gives `/privacidad` without slash, matching the canonical. |
| No React or other UI framework, no islands | The pages have no interactive state that needs one. |
| Zero client JavaScript by default; only two optional modules: the demo form enhancement (when the form is enabled) and the analytics listener (when analytics is enabled) | Performance budget and a page that works without scripts. The mobile menu and the FAQ use native `<details>`; the form outcome uses `:target`. |
| Shared code through the `@shared` alias (`shared/result.ts`, `shared/phone.ts`), also `@docs` for the tokens | Reuse without installing `shared`: both files import nothing. |
| One token adapter (`landing/src/styles/design-theme.ts`) builds CSS custom properties from `docs/design-tokens.json`; light theme only: the landing has no dark mode (founder decision, 2026-10-21) | Single source of brand values; token values are never copied into CSS. |
| Landing-only tokens (display and headline typography roles, spacing 64/96, pill radius, 1200 max width) added to the shared token file | Same token file and documentation rule as the apps; no existing key changed. |
| Inter Variable from the lockfile-pinned `@fontsource-variable/inter`, latin `wght` file only, `font-display: swap`, preloaded, with a metric-adjusted local fallback | Same package as core; Astro's fonts API downloads from a remote CDN instead. The fallback avoids layout shift on swap. |
| Lucide icons through `@lucide/astro`, rendered to inline SVG at build | Icon set of `DESIGN.md`, with no JavaScript. |
| Yoyos logos, favicon and apple-touch-icon copied from `apps/core` into the landing | The landing builds and deploys alone and does not reach into another app's tree. |
| Screenshots typed as provisional or real (`ScreenshotSlot`); the 12 current ones are real | A placeholder can never ship as if it were real. |
| Partner logos rendered through `astro:assets` at the control height | Images are hashed and sized without upscaling their intrinsic resolution. |
| `public/_headers` sets `Cache-Control: public, max-age=31536000, immutable` for `/_astro/*` | Hashed assets are cacheable forever; applying the file is the host's job. |
| `landing` in `.dockerignore`; no compose changes | The core image build context is not affected. |
| ESLint 10 flat config with `eslint-plugin-astro` and its strict jsx-a11y rules | `eslint-plugin-astro@3` requires ESLint 10; core stays on its own version. |
| Typecheck with `astro check` (TypeScript 6, as core) | It checks `.astro` and `.ts` with one config; `tsc` cannot read `.astro` imports, and `@astrojs/check` does not accept TypeScript 7. |

## Quality targets

- **Performance:** Lighthouse mobile at least 95 in Performance, Accessibility, Best Practices and SEO. Core Web Vitals: LCP ≤ 2.5 s on Slow 4G (internal goal 2.0 s), CLS ≤ 0.1, INP ≤ 200 ms, TTFB ≤ 0.8 s. Budget: total JavaScript ≤ 50 KB, home HTML with critical CSS and JS ≤ 100 KB gzip, first view ≤ 500 KB.
- **Images:** real images go through `astro:assets` `<Picture>` in AVIF and WebP with `widths`/`sizes` and explicit `width`/`height`, lazy below the fold. The hero image (LCP) is eager, `fetchpriority="high"`, preloaded from its `imagesrcset`, without video or carousel. No render-blocking third-party scripts.
- **Accessibility:** WCAG AA contrast, visible focus, full keyboard navigation, a skip link «Ir al contenido» first in every page, literal alt texts from the content (feature captures have no alt in the content and are decorative), aria-labels on «Llámanos» and the menu («Abrir menú» / «Cerrar menú»).
- **Responsive:** mobile first, reviewed at 360, 768 and 1280 px in the light theme. Pages reflow without horizontal page scroll at 360 px with the browser default font size at 200%: headings, paragraphs, list items, summaries and pill labels wrap long words (`overflow-wrap: anywhere`) instead of widening grid tracks. How to measure it is in the README.
- **Style:** visual reference for style only (clean SaaS look, adapted to Yoyos tokens): [Eario.ai SaaS landing](https://dribbble.com/shots/26360891-SaaS-Website-Landing-Page). Content and sections are always those of the content modules.

## Verification

Automated, in the `landing` CI job (install, lint, typecheck, unit tests, build, build-output tests):

- **Unit tests** (Vitest, colocated) cover the configuration parser, contact links, SEO helpers, the JSON-LD graph against the approved fixture, the manifest, the analytics event mapping and the token adapter.
- **Build-output tests** build two variants with explicit variables (`minimal`: required variables only, indexing off; `full`: indexing, analytics, login, form action, email and social set) and assert on `dist`: indexing modes and robots, sitemap, headings, canonical and hreflang, JSON-LD presence, referenced assets, alt and image dimensions, JavaScript and critical-byte budgets, visibility rules, the demo form contract and outcome blocks, the privacy page and its placeholders.
- **Source scans** forbid the sales phone number and the site domain in source, color/radius/size literals in CSS outside the token adapter, and guard the text-zoom wrapping rule.

Manual, with results in the pull request: Lighthouse mobile on the production build; Rich Results Test and validator.schema.org on the home JSON-LD; 360/768/1280 px in the light theme and the 200% text check; keyboard-only navigation; axe on `/`, `/privacidad` and the 404; the demo form without and with JavaScript against a stub endpoint answering the redirects above; the WhatsApp link preview of the Open Graph image once there is a public URL.

## Known limits

- Astro also emits JavaScript chunks for components that a variant does not render (for example the form enhancement when the form is disabled). The build removes every `.js` file, and its `.map`, that no page loads through `<script src>` or an import of a loaded script, and logs the removed names as one `pruned_unreferenced_scripts` JSON line. The minimal variant therefore ships no JavaScript file, and the budget and zero-JavaScript tests run over what `dist` holds.
- The real 404 status depends on the host; Astro emits `404.html`.

## Provisional content

The app screenshots (hero, the five steps, the six feature cards) are final: 12 PNG composed at the slot ratios (hero 4:5, steps 4:3, cards 16:10), 2160 px wide (hero 1728), in `landing/src/assets/screenshots/`, wired as `kind: "image"` slots in the content modules. Replacing one means replacing the file at the same ratio. These elements are placeholders, marked as such, until the founder or Marketing supplies the real ones:

- The Open Graph image is rendered with a system font and awaits Marketing's approval or replacement.
- Company data in `/privacidad` (bracketed placeholders), the contact email and the social URLs.
