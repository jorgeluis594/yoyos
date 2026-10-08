---
version: 1
slug: "settings-presentation-delivery-settings-screen-tsx"
primary_target: "apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx"
related_targets: []
---

# Native delivery settings

Operate; preserves compact caramel and native conventions. Spanish/Portuguese labeled fields/Switches independently enable home/store/agency. Scroll, keyboard, safe areas, max640 form width, and minimum 48-unit controls accommodate native use. Version-0 defaults disable all modalities with null pickup; disabling retains its point. Complete pickup name/address are trimmed; blank optional instructions normalize to null. Courier rows support unsaved add/remove, persisted rename/deactivation, and retained inactive rows. Local keys are excluded from requests; confirmed saves restore canonical IDs. Complete versioned saves preserve every row, flag, and pickup field on conflict until explicit reload; success resets canonical fields/version. Mobile web tabs remain in normal flow and wrap the fourth tab.

Final configured core/mobile lint, typecheck, and complete unit suites passed on 2026-10-06. Mobile lint retains three baseline warnings and zero errors. Complete integration/browser suites passed at 1289627; later changes are documentation/captures.

Final reviewer `/root/native_delivery_finish`: ship only for reviewed Android phone interfaces/journeys on Samsung A56 in Expo Go, without material UI fixes or new visual direction. Earlier recapture is superseded within this scope. Actual light/dark, text scale1.3, keyboard, scrolled regions, selectors, and recovery evidence is sufficient without a Cartesian matrix. Evidence: `.impeccable/review/android-settings-light.png`, `android-store-settings-dark.png`, `android-settings-large-text.png`, `android-settings-keyboard-dark.png`, plus current recaptures b1e6e08/c263bfe and original `android-*.png` captures.

User explicitly deferred iOS: “no es necesario probar en IOs por ahra”. iOS, tablet, and distributed runtime stability are outside approval. One NativeRNScreens incident remains open; six tab changes and three background cycles did not reproduce it. No runtime fix or resolution is claimed.

## Delivery-settings composition revision — 2026-10-08

Scope: delivery-settings only, Operate. The coordinator approved A after inspecting exactly three native portrait raster comps: `.impeccable/mocks/delivery-settings/a-grouped.png`, `b-disclosure.png`, and `c-overview.png`; A's JSON records approval. B hides fields behind disclosure; C separates enablement from configuration. A keeps each modality and its controls together.

THESIS: Three open modality groups and a save action visible above native tabs when the keyboard is closed.
OWN-WORLD: Existing Caramelo sobrio, Inter static native weights, flat white/charcoal groups and discreet borders.
STORY: Enable modalities, edit their retained data, save with explicit success/error feedback.
FIRST VIEWPORT: Compact heading, open pickup group with switch alongside heading, remaining groups in a scroll region; save footer has its own space above native tabs.
FORM: Approved A; precise local revision, no concept seed or global identity change.
FINISH: Local surface documentation and existing native evidence record the finish review and its limits; global DESIGN.md is outside this worker ownership. No raster ships in the interface.

| Comp ingredient | Implementation medium / commitment |
| --- | --- |
| Canvas and group surfaces | Native View with existing light/dark tokens; no gradients or textures |
| Three modality headings and switches | Native text/switch controls, heading and explanatory label beside switch, 48-unit minimum rows |
| Pickup, courier and PE zone fields | Existing labeled native inputs and controls; all helpers retained |
| Save and recovery | Existing real buttons in normal-flow footer outside ScrollView; safe area and keyboard handling |
| Navigation | Existing native tabs and system navigation, untouched |

Pixel samples from A (853×1844): canvas (15,900) `#F8F5F1`, group (45,700) `#FEFDFD`, primary (100,1530) `#935A2F`. These generated approximations map to established tokens rather than redefine global colors. Flat surfaces, 8-unit group radius, 6-unit controls, 1-unit decorative border, existing title/subtitle/body/small type ramp. Generated mock shadows/texture and incorrect add-courier switch are artifacts; coordinator explicitly requires real add button and courier enablement, unchanged helpers, fields and zones. Synthetic values in mocks are illustrative only.

Asset producer `/root/delivery_asset_manifest` independently found an empty production raster manifest; all visible UI remains semantic native controls. Existing navigation is not recreated. Rasters are decision evidence only, with exact prompts embedded and adjacent sidecars.

## Final evidence and disposition

Native reproduction checkpoint: `.impeccable/review/delivery-settings/android-light-top.png`. The adjacent `android-light-bottom.png` shows successful native saving and an unobscured action above tabs; dark/large-text top, home, agency and bottom captures cover the open groups at font scale 1.3. These are Samsung A56 native captures at physical 1080×2340, density 450 (approximately 384 logical units wide), not browser simulations. Exact evidence and remaining limits are in `.impeccable/review/delivery-settings/report.md`.

Node 24 configured mobile lint passed with three pre-existing warnings and no errors; typecheck passed. The full configured mobile suite passed on the second run with original timeouts; the first run had five unrelated timeout failures under concurrent host load. After correcting Android's duplicate bottom inset, the coordinator-authorized delivery-screen suite, lint and typecheck passed again. The final one-line Android keyboard behavior adjustment was not rechecked: the user explicitly stopped further tests and native QA. No new test logic, dependency or shared component was introduced.

Finish reviewer `/root/delivery_finish_review` returned `fix`: the keyboard capture hid Save, and final evidence/documentation needed recording. Local documentation is now complete; Android keyboard handling delegates resizing to the OS, but its effect is unverified. The coordinator subsequently narrowed acceptance explicitly to an accessible CTA after closing the keyboard and requested closure using existing evidence, without another review round. This is not an unrestricted reviewer ship verdict. iOS/tablet and expanded keyboard validation remain untested; the shared native tab label truncation at large text is outside this surface.

The native HTML/CSS detector was skipped because it does not validate React Native. SDK 57 versioned Expo URL returned 404; Context7 and installed expo-router 57.0.22 types/source informed platform inset handling. No mobile AGENTS.md exists in this checkout. Authorized existing dependency symlinks were used after the base shared lockfile failed frozen installation with multiple YAML documents; no lockfile changed.

Samsung settings were restored to font scale 1.0, night mode no, physical size/density with no overrides; user-requested USB stay-awake value 2 was retained. Device released and this worker's Metro stopped. No push or merge.
