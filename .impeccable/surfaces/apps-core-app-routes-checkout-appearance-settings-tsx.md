---
version: 1
slug: "apps-core-app-routes-checkout-appearance-settings-tsx"
primary_target: "apps/core/app/routes/checkout-appearance-settings.tsx"
related_targets: ["apps/core/src/features/checkout-appearance/presentation/checkout-preview-frame.tsx", "apps/core/src/features/checkout-appearance/presentation/brand-color-dialog.tsx", "apps/core/app/routes/checkout-appearance-preview.tsx"]
---

# Apariencia del checkout: editor

Mode: Operate. Extends Caramelo sobrio. Approved comp: `.impeccable/mocks/checkout-editable/a4-closed-{light,dark}.png` and `a4-dialog-{light,dark}.png` (a4, approved 2026-10-10; JSON sidecar `a4.json`). The mock decides layout and hierarchy; the real checkout and the real admin shell decide content.

## Review of the built editor against a4 (T5)

Captured with the E2E fixtures (Lima Studio, Bosque, fondo «De marca») at 1440×900 and 390×844, light and dark, closed and with the color dialog open: `.impeccable/review/checkout-appearance/{desktop,phone}-{light,dark}[-dialog].png`. The admin dark theme is the app's `.dark` class; the preview mode is switched with «Oscuro».

Matches the mock:

- Desktop: preview as the main region on the left (about two thirds), inspector on the right with Logo, Color de marca (one swatch row of the active mode, name, «Cambiar»), Fondo (segmented Blanco / Neutro / De marca with hint) and Restablecer. Header with «Cambios sin guardar», «Descartar» and «Guardar cambios».
- The color dialog lists the 9 predefined colors, no HEX field, with «Cancelar» and «Usar <color>»; swatches follow the preview mode.
- Phone: one column with «Editar / Vista previa» tabs; the preview fills the width.
- Dark: caramel actions in the editor, brand color only inside the preview and swatches.

Fixed during review:

- «De marca» wrapped to two lines in the 22 rem inspector on desktop; the segments no longer wrap.

Differences kept on purpose (not defects):

| Mock | Built | Reason |
| --- | --- | --- |
| Phone frame with status bar and fixed «Revisa y confirma» content with «Tus datos / Editar» cards | Real checkout inside a plain phone frame | Design 10.6: the preview reuses the real checkout; the mock cards were illustrative. |
| Toolbar order Revisión/Pago · dispositivo · modo, with an eye badge «Vista previa · Datos de ejemplo» in the bar | Order dispositivo · modo · estado; the «Vista previa · Datos de ejemplo» label is the first line inside the preview | Label stays inside the iframe so it cannot be removed and is read with the preview. |
| Device/mode buttons with icons | Text-only segmented controls | Labels are enough for 6 options; keeps the controls compact. |
| «Cambios sin guardar» chip with an amber dot | Neutral secondary chip | Uses the existing secondary token; the text carries the state. |
| Logo row shows the file name and «Cambiar» at the right | Logo box, «Logo cargado / Sin logo» and hint, buttons below | The file name is not kept after upload; stacked buttons fit the 22 rem inspector. |
| Navigation labels «Entregas», «Cobros», «Apariencia» | «Modalidades de entrega», «Medios de cobro», «Apariencia del checkout» | The mock's sidebar was not the real app's; the real labels are kept. |
| Phone: edit controls and preview in one scroll | Tabs and the three preview segmented controls wrap onto three rows above the frame | Acceptable at 390 px; no horizontal scroll. A single row would need icons or a menu. |

## Evidence limits

Visual comparison was done by looking at the captures against the mock PNGs, with no pixel diff. Contrast of the 54 color/background/mode combinations is covered by the Storybook axe check recorded in the T0 review, not repeated here. The detector (`detect.mjs`) and a dual-agent critique were not run; the task asked for a comparison with the approved mock.
