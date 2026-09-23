# Product — Yoyos

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

The web and mobile apps form one product, sharing its purpose and business rules. The mobile app must adapt its experience to iOS and Android, respecting each operating system's conventions.

## Users

The direct users are sellers and their management teams. The initial audience is sellers who sell through live streams.

Potential buyer interactions for confirming or paying for an order remain undefined. A buyer application has not been established as part of the scope.

## Product Purpose

Yoyos is a social commerce platform for managing sales that originate on external social networks. It connects that selling activity with closing sales, taking orders, managing products, and running the business.

The goal is to streamline the seller's and their team's work throughout this process. Specific success metrics remain undecided.

## Positioning

Selling happens on social networks through status posts and live streams, including TikTok live streams. WhatsApp is the primary communication channel. Yoyos supports this process with tools to close and manage sales.

AI should accelerate processes and tasks through concrete automations. An AI chat is not the center of the experience.

The user's competitive research found no direct competitors serving the same purpose as Yoyos. Adjacent solutions exist, but their purpose differs from Yoyos's focus on connecting external social selling with closing sales and managing the business.

## Operating Context

Sellers and their teams work across the social networks where they sell, WhatsApp, and Yoyos. The initial usage context is live selling and its associated management work.

The overall workflow connects selling on social networks with closing and recording orders, payment, and delivery status tracking. The exact steps, responsibilities, and automations still need to be defined.

## Capabilities and Constraints

- Each business manages its own sales; Yoyos is not a marketplace.
- Closing sales, taking orders, managing products, and managing the business.
- Payments and delivery statuses are included in the intended scope.
- Courier integrations are possible, but implementation is not committed and providers have not been selected.
- Country and language support is expected; initial countries, languages, and currencies remain undecided.
- AI automations should address concrete tasks; the first use cases remain undecided.
- WhatsApp is the primary communication channel, but its technical integration and those of other social networks remain undefined.
- Open decisions include team roles and permissions, payment providers and methods, exact order and delivery states, and the initial sellers' product categories.

These capabilities describe the intended product scope, not functionality already implemented.

## Brand Commitments

The confirmed brand name is **Yoyos**. Its visual personality is trustworthy and professional, with restrained color to avoid overstimulating entrepreneurs during demanding work. Brand voice remains undecided.

The user selected compact visual density with discreet borders to manage many sales, and the same typeface across the web and mobile product interfaces. `DESIGN.md` defines the first shared visual convention; its proposed font is Inter. Native system controls may retain platform typography and behavior.

The user selected **Caramelo sobrio**, inspired by their dog's charcoal, caramel, and cream coat, after reviewing light and dark palette samples. Red from the reference photo's clothing is not part of the selected palette.

| Color role | Light mode | Dark mode |
| --- | --- | --- |
| Canvas | Cream `#F7F4EF` | Charcoal `#1C1B1D` |
| Raised surface | White `#FFFFFF` | Charcoal `#272528` |
| Primary text | Charcoal `#242326` | Ivory `#EEE8DF` |
| Primary action / accent | Toasted caramel `#8C552D` | Light caramel `#D5A16C` |
| Text on primary action | White `#FFFFFF` | Charcoal `#1C1B1D` |

Use calm neutral backgrounds and concentrate brand color on primary actions and selected states. Dark mode is required because many sellers work at night. The web theme uses these approved colors; the mobile theme is still unimplemented. Semantic status colors and full interaction-state contrast validation remain to be defined.

## Evidence on Hand

- The product decisions in this document were confirmed by the user during Impeccable initialization. Open decisions are explicitly identified.
- `docs/adr-001-full-stack-monolith.md` documents the intended technical foundation for the web, API, payments, and other modules.
- `apps/core/` contains the web and server foundation; its home page is a placeholder.
- `apps/mobile/` contains the Expo mobile foundation with sample screens and assets. Those assets do not establish the Yoyos identity.
- The user reports having researched competitors and found adjacent solutions, but no direct competitors with the same purpose. Specific comparisons and research sources have not been recorded here.
- No testimonials, outcome metrics, or customer case studies were supplied. Do not invent them as commercial evidence.

## Product Principles

1. Design for live sellers and their management teams.
2. Connect sales on social networks and WhatsApp communication to business operations.
3. Use AI to streamline concrete business tasks.
4. Maintain one product across web and mobile while respecting each platform's experience.
5. Prioritize managing each business's own sales, payments, and delivery statuses within the confirmed scope.
