---
name: Yoyos — Caramelo sobrio
description: Shared visual conventions for clear, compact sales management.
---

# Design System: Yoyos

## Overview

**Creative North Star: "Restrained caramel, clear workflows"**

A trustworthy, compact, warm interface for managing sales. Neutral surfaces, comparable rows, and subtle borders lead the design. Caramel identifies primary actions and selections, keeping the data in focus.

**Status:** v1 specification for implementation. The user confirmed the Caramelo sobrio palette, dark mode, compact density, and a shared typeface across web and mobile. Inter, measurements, and complementary semantic colors are proposed decisions in this first convention; they do not yet constitute an implementation or visual validation on devices.

**Source of truth:** [docs/design-tokens.json](docs/design-tokens.json) defines values; this document defines their use. Names represent roles, not specific colors. Adjustments start in the tokens and then flow into their platform adapters.

**Key Characteristics:**

- Compact density through composition and spacing, with legible text and comfortable touch targets.
- One typeface family for Yoyos product content.
- Flat surfaces and subtly rounded shapes.
- Shared identity, with navigation and system controls adapted to each platform.

At the initial review, `apps/core` has a minimal home page and no `components.json`; `apps/mobile` retains Expo sample components and colors. These template styles do not establish the Yoyos identity. The JSON is a data specification, not yet imported by the applications.

## Colors

The approved foundation combines cream, charcoal, and caramel. Exact values for both themes live in `colors.light` and `colors.dark` in the token file.

| Token | Role |
| --- | --- |
| `background` / `foreground` | Main canvas and primary text. |
| `card` / `card-foreground` | Content containers. |
| `popover` / `popover-foreground` | Menus and overlay surfaces. |
| `primary` / `primary-foreground` | Primary action and its text/icon. |
| `primary-hover` / `primary-pressed` | Pointer and press feedback; retain `primary-foreground`. |
| `secondary` / `secondary-foreground` | Secondary actions on neutral backgrounds. |
| `muted` / `muted-foreground` | Secondary areas and supporting text; this text color also applies on the canvas and cards. |
| `accent` / `accent-foreground` | Background and text for selection or subtle highlighting. |
| `border` | Decorative separators and card boundaries. |
| `input` | Perceptible border for fields and controls that need a visible boundary. |
| `ring` | Keyboard focus indicator. |
| `destructive` / `destructive-foreground` | Actions that delete or destroy data, with dedicated hover and pressed states. |
| `success` / `success-surface` | Text/icon and background for positive confirmation. |
| `warning` / `warning-surface` | Text/icon and background for items needing attention. |
| `error` / `error-surface` | Text/icon and background for errors. |
| `info` / `info-surface` | Text/icon and background for neutral information. |

**Intentional brand color.** Concentrate caramel on the primary action and selections. Status colors use restrained green, amber, red, and blue tones; functional error red does not become a brand color.

Always pair `primary`, `secondary`, `muted`, `accent`, `card`, and `popover` with their corresponding `-foreground` token. For statuses, `success` is the text on `success-surface`; the same applies to warning/error/info. Do not automatically place white text on dark-mode colors.

Selection includes an additional indicator, such as a checkmark or active position. A status includes text and, when helpful, an icon: color alone does not convey its meaning. Do not assign final order, payment, or delivery statuses before agreeing on their business rules.

The theme follows the system by default and supports an explicit light/dark/system preference. Both themes use the same roles. System controls may retain their native appearance.

This convention targets a contrast ratio of at least 4.5:1 for all functional text, including small and supporting text. Essential control boundaries and focus indicators target at least 3:1 against adjacent colors. `border` is decorative: it does not replace `input` when the boundary identifies a control. References: [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## Typography

**Proposed typeface: Inter**, for content, headings, fields, and buttons on both platforms. Use the same files and version, hosted with the product. Weights: regular (400), medium (500), and semibold (600). [Official typeface and license](https://rsms.me/inter/).

Typography in operating-system dialogs, pickers, or navigation may remain native. System fonts are the loading fallback, not a deliberate second identity.

| Role | Use |
| --- | --- |
| `page-title` | Main screen title; no oversized hero headings in management views. |
| `section-title` | Section or panel headings. |
| `body` | Reading, forms, and primary mobile content. |
| `body-compact` | Table rows, dense lists, and secondary data. |
| `label` | Buttons, labels, table headers, and navigation. |
| `caption` | Supplementary metadata; never primary amounts, errors, or essential instructions. |

Sizes and line heights live in `typography.roles`. On the web, convert them to rem using 16 as the initial reference, without locking the user's root font size. On mobile, use logical sizes that respect system text scaling. Mobile fields use `body`; controls grow when the text requires it.

Use sentence case and left alignment. Right-align comparable amounts and quantities, using tabular figures. Keep the currency visible; formatting depends on the product's locale settings. Do not invent a global country or currency.

## Layout

**Compact does not mean small.** Reduce ornamental padding, nested cards, and repeated headings before reducing text or interaction areas.

The `spacing` scale is shared. Geometry values represent CSS pixels on the web and density-independent logical units on mobile, never physical screen pixels.

| Aspect | Desktop web | Mobile and touchscreens |
| --- | --- | --- |
| Page gutter | 24 | 16, plus safe areas. |
| Section gap | 24 | 24. |
| Label → field | 8 | 8. |
| Between fields | 16 | 16. |
| Standard control | Minimum height 36 | Minimum height/touch target 48. |
| Data row | Minimum height 40 | Minimum 56 when it contains text and actions. |
| Container | Maximum 1440, centered | One column by default. |
| Form | Maximum 640 | Available width. |

These values summarize `layout` and `sizing`; the JSON takes precedence when updated. Heights are minimums, never rigid values that clip content. Apply touch sizing on touch-enabled web interfaces too, even on large screens. Separate adjacent touch targets by at least 8 units and avoid overlapping invisible hit areas.

On desktop, favor tables for comparing many sales, search/filter tools beside the list, and secondary actions per row. On mobile, show essential information in list rows and open details for the rest. Retain a scrollable table only when column comparison is necessary.

Web navigation may use a sidebar; mobile uses tabs for primary destinations, a navigation stack for details, and native back behavior. Share destination names and hierarchy; determine the structure from actual modules without defining nonexistent screens.

Adaptations depend on available space and content, not just device labels. Respect the keyboard, safe areas, and orientation. Do not hide essential actions exclusively behind hover or gestures.

## Elevation & Depth

Flat by default. Separate groups through spacing, headings, dividers, or surface changes. Cards have no shadow by default. Avoid wrapping every data point or row in a card.

Reserve elevation for actual overlays: menus, dialogs, and panels. On the web, use one subtle reference shadow (`0 8px 24px rgb(0 0 0 / 0.16)`) with a border; in dark mode, surface and border contrast must still define the panel. On mobile, use elevation appropriate to the native component; do not require identical shadows across systems.

Functional motion: brief color/opacity feedback and panel appearance, using the durations in `motion`. No bouncing, row displacement on hover, or persistent decorative animation. Respect reduced motion; native controls retain their system transitions.

## Shapes

Use `radius` roles: subtle badges (4), controls (6), cards (8), and custom panels (12). Circular avatars. Do not turn every button into a pill.

Borders are one unit wide. Achieve density through alignment and grouping, not by accumulating lines. System components retain their native shapes when controlled by the platform.

Proposed iconography: Lucide outline icons for product icons on web and mobile, using the same symbol for each concept. Sizes and stroke width live in `sizing`. Do not mix icon families for equivalent actions. System navigation symbols are a deliberate exception. An icon-only button always has an accessible name and a full interaction area.

## Components

These are implementation recipes, not an existing component catalog.

| Component | Convention |
| --- | --- |
| Primary button | `primary` + `primary-foreground`, medium weight, `control` radius; one most-emphasized action per task region. |
| Secondary button | `secondary` + `secondary-foreground`; same radius and typography as the primary button. |
| Ghost button | Transparent background and `foreground` text; hover/pressed use `accent` + `accent-foreground`. |
| Destructive action | `destructive` variant; request confirmation when irreversible consequences warrant it. |
| Field | `card` background, `card-foreground` text, `input` border, visible label above; placeholder is supporting text, never a label replacement. |
| Field error | `error` border and message; the message below explains how to fix the issue without clearing the entered value. |
| Card | `card` + `card-foreground`, `border` border, `card` radius, padding 16; one coherent unit of information. |
| Table/list | Medium-weight header, regular text, aligned numbers; selection uses `accent` and an explicit marker. Row actions are accessible by keyboard and touch. |
| Status badge | Semantic color on its matching surface, `badge` radius, brief text; informational unless explicitly presented as a filter. |
| Active filter | `accent` background, `accent-foreground` text, selection marker, and visible removal mechanism. |
| Dialog/panel | Clear title, organized content and actions; restores focus on close on the web and respects back/keyboard behavior on mobile. |

### States and interaction

- **Hover:** pointer only; primary/destructive have dedicated tokens. Secondary and ghost use the accent pair. Component size stays unchanged.
- **Pressed:** primary/destructive use their pressed tokens; secondary/ghost retain accent and the platform's native touch feedback.
- **Focus:** `ring` outline, width and offset from `sizing`, visible against the surrounding surface. Do not reduce its opacity or clip it inside the container.
- **Disabled:** muted surface, muted-foreground text, disabled semantics, and no activation. Explain the reason when it is not obvious. Do not reuse this appearance for read-only fields, which remain legible and selectable.
- **Loading:** preserve button width, show progress and a label such as “Saving…”, prevent duplicate submissions, and announce the state to assistive technology. In lists, retain previous content during refresh when it remains valid.
- **Empty:** explain what is missing and offer the next useful action. Distinguish “no results” from “no records yet”.
- **Error:** persistent message near the task, preserves data, and offers retry when possible. A transient notification must not be the only explanation of a failure.
- **Success:** brief confirmation without interrupting work; lasting statuses remain visible on the corresponding record.

### Language

Proposed tone: direct, calm, and useful. Use concrete verbs: “Save changes”, “Create order”, “Retry”. Avoid “OK” when the action can be named. Use the same concepts and terminology on both platforms. Avoid internal jargon, blame, repeated celebrations, and unnecessary exclamation marks.

### Platform mapping

On the web, use the semantic pairs in [shadcn/ui theming](https://ui.shadcn.com/docs/theming). `primary` is the brand action; `accent` is subtle highlighting. The success/warning/info statuses and hover/pressed variants are Yoyos extensions, not tokens automatically consumed by every shadcn component. Map radii explicitly rather than assuming a preset matches these measurements.

On mobile, adapt the same values and roles to the existing React Native/NativeWind theme and components. Share tokens, vocabulary, and recipes; maintain a separate implementation per platform. Web shadcn components are not imported as native controls.

Do not create a package, generator, or new UI library just to share this file yet. During implementation, connect the JSON to minimal adapters for each application and verify their output; do not maintain independent copies of values by hand. Install fonts or icons only when used.

### Visual reference and acceptance

The first implementation must include an internal reference screen on the web and another in the app, with the same demonstration content: typography scale, button variants, normal/error/disabled fields, a card, a row, semantic badges, and selection. Examples do not define business statuses.

Compare both in light and dark themes, with enlarged text, web keyboard/focus behavior, and mobile touch targets. Verify the mobile reference on iOS and Android, not just in a browser. Reference screens have not yet been built during this definition phase.

## Do's and Don'ts

### Do

- Reuse tokens and variants; resolve shared exceptions in the component rather than per screen.
- Maintain the same visual hierarchy, typeface, and color meanings across platforms.
- Increase height and allow wrapping when text or accessibility requires it.
- Review both themes whenever a component or state is introduced.
- Update values in `docs/design-tokens.json` and their usage in this document in the same change.

### Don't

- Introduce literal colors, radii, or arbitrary sizes on each screen.
- Confuse Expo template styling or a shadcn preset with brand decisions.
- Reduce touch targets or contrast to gain density.
- Rely solely on color, hover, or a hidden gesture to convey an action or state.
- Apply identical web navigation to mobile or force custom styling onto system controls.
- Claim these tokens are applied or that the product passes an accessibility audit without verifying its implementation.
