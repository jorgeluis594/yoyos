# Core web design system

Every reusable visual component of `apps/core` lives in
`apps/core/app/components/ui/`. Routes and features compose those pieces; they do
not copy classes or use unstyled native controls (bare `<select>`, `<dialog>`,
`<p role="alert">` or `<input type="checkbox">`). Visual values come from
[`design-tokens.json`](design-tokens.json) and their use is defined in
[DESIGN.md](../DESIGN.md). Each component has a Storybook story next to it
(`pnpm --dir apps/core storybook`).

## Where components come from

1. **shadcn/ui is the base** (`apps/core/components.json`: style `radix-nova`,
   lucide icons). If shadcn has the component, add it with the CLI from
   `apps/core`: `pnpm dlx shadcn@latest add <component>`. Reason: proven,
   accessible primitives instead of hand-written ones.
2. **Once in the repo, the component is ours.** It is customized with project
   tokens without changing its structure or API. Never run `add --overwrite` on an
   existing file; use `--diff` and merge upstream changes by hand. Reason:
   overwriting would silently drop the project customizations.
3. **If shadcn does not have it**, write it by hand following the same conventions.

Customization applied to everything taken from shadcn:

- Radii use tokens: `rounded-[var(--radius-control|card|overlay|badge)]`.
- Project focus ring: `focus-visible:ring-2 focus-visible:ring-ring` (with offset on small controls).
- Semantic colors: `success`, `warning` and `info` variants using `--*-surface` / `--*`; no raw palettes or `bg-black/…`.
- No hard-coded text: labels arrive through `children` or explicit props (`closeLabel`, `aria-label`) so they are translated.
- Touch targets: `app/app.css` applies `min-height: var(--touch-target-min-size)`
  to buttons, navigation links, pagination links, tab triggers and toggle-group items.

## API rules

- **Composition, not prop bags.** Each part is a subcomponent; no `labels={{...}}`, `options={[...]}` or `footer={...}`.
- **`data-slot`** on every part; states go in attributes (`data-variant`, `data-orientation`, `data-state`) and styles hook onto them.
- **Native props pass through** and `className` is merged with `cn`.
- **`asChild`** (Radix Slot) renders a react-router `<Link>` with component styles.

## Inventory

| Component | Origin |
| --- | --- |
| Alert, Badge, Checkbox, Dialog, Empty, Pagination, RadioGroup, Switch, Tabs, Toggle, ToggleGroup, Button, Card, Input, Label, Sheet, Skeleton, Table, Textarea | shadcn, customized with tokens |
| Field, Select, Combobox | shadcn parts on base-ui, adapted to the house controls |
| TextLink, DescriptionList, FileUpload, AuthLayout, DataTable, FilterBar, PageContainer, PageHeader, ErrorState | hand-written (not in shadcn) |

## Usage rules

- **Alert**: variants `default | destructive | success | warning | info`.
  `destructive` uses `role="alert"`, the others `role="status"`; `role` can be
  overridden (for example `role="note"`). A short message under a button uses only
  `AlertTitle`. A field error uses `FieldError`, not Alert.
- **Checkbox and RadioGroup** are Radix buttons that add a hidden input with
  `name`/`value`, so native form submits work. With react-hook-form use
  `Controller`, never `register(...)`. Layout: `Field orientation="horizontal"`;
  a group is `FieldSet` + `FieldLegend variant="label"`. An option card is a
  `FieldLabel` wrapping a `Field`.
- **ToggleGroup** replaces segmented controls (2 to 7 options). In `single` mode
  Radix allows deselecting and passes `""`, so guard with `value && setValue(value)`.
  Items expose `role="radio"` with `aria-checked`.
- **Tabs**: `TabsList variant="default"` is the pill style, `variant="line"` the
  underline. To keep form state across tabs use `forceMount` with
  `className="data-[state=inactive]:hidden"` on `TabsContent`.
- **Dialog**: `DialogContent closeLabel` shows the close button; other close
  actions are composed with `DialogClose`. Navigation drawers use `Sheet`.
- **Pagination**: `aria-label` and all texts come from the route; links use `asChild`
  with `<Link>`. The active page uses `default`, the rest `outline`. Page state
  and href building stay in the route.
- **Badge**: variants include `success | warning | info`; radius `--radius-badge`.
- **Empty** is for empty sections, carts and `DataTable`'s `emptyMessage`;
  `ErrorState` is the full-screen error.
- **Field** (base-ui) provides `FieldSet`, `FieldLegend`, `FieldContent`,
  `FieldTitle`, `FieldDescription` and `orientation` (`vertical | horizontal`).
  Use `Field` + `FieldLabel` instead of `<label>` + `Input`.
- **Select** (base-ui) is the only select. `name` renders a hidden input so the
  value is submitted with native or GET forms. Pass `items={[{ value, label }]}`
  so `SelectValue` shows the label, not the code. No selection is `value={null}`
  with a placeholder, never `""`. With react-hook-form, `onValueChange={field.onChange}`
  and `inputRef={field.ref}`. In tests, click the trigger and then the
  `role="option"` by its label (Playwright cannot use `selectOption`). Options
  are not rendered in SSR while the popup is closed.
- **TextLink** is the inline text link; a button that looks like a link is `Button variant="link"`.
- **DescriptionList**: `horizontal` (default) for amount summaries with
  `tabular-nums`; `vertical` for payment or delivery details.
- **FileUpload**: the native input is hidden (`data-slot="file-upload-input"`,
  out of tab order) and reset after each selection, so choosing the same file
  again fires `onFileSelect`. Accessible controls are `FileUploadTrigger` or
  `FileUploadDropzone`; `FieldLabel htmlFor` points to the trigger. In e2e tests
  use `setInputFiles` on `[data-slot="file-upload-input"]`. Upload progress, error
  and retry are composed by the route with `Alert`.
- **AuthLayout** is the single authentication layout: a `max-w-sm` card; pass
  `className="max-w-lg"` when a screen needs more width.
- **Card** for bordered sections, `PageContainer` and `PageHeader` for page
  layout, `DataTable`/`Table` for tables, and `FilterBar` for list searches
  (see [Frontend development](frontend-development.md#list-filters)).

## Not created

| Component | Decision |
| --- | --- |
| `NativeSelect` | `ui/select` is the only select, for one consistent behavior. |
| shadcn's Radix Select | The base-ui `ui/select` is already customized; it is not overwritten. |
| `SelectField` / `options` prop | It would be a prop bag; composition is short. A repeated select becomes a feature component composing `Select`. |
| Collapsible / Accordion | Native `<details>` is accessible and has few uses. Add `collapsible` from shadcn if a shared pattern appears. |
| CheckboxGroup | `FieldSet` plus several horizontal `Field`s covers it. |
| Toast | Notices use `Alert`. |
| Single-use pieces (ColorSwatch, LogoFrame, Avatar, Breadcrumb, Sidebar…) | Composed in place with existing components; if standardized, they come from shadcn. |

A fixed `bg-white` behind uploaded logos is intentional: logos need a neutral background.
