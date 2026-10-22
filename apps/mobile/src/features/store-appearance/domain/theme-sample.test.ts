import { storeThemeIds, storeThemes, type CssValue, type StoreThemeDefinition } from "@shared/store-themes";
import { themeSample } from "@mobile/features/store-appearance/domain/theme-sample";

function sampleOf(theme: StoreThemeDefinition) {
  const result = themeSample(theme);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

test("theme samples use each theme's colors, button radius and thumbnail shape", () => {
  const classic = sampleOf(storeThemes.classic);
  expect(classic).toMatchObject({ background: "#FFFFFF", gradient: null, card: "#FFFFFF", thumbnail: "#EDEDED", border: "#E5E5E5", borderWidth: 1, primary: "#111111", primaryForeground: "#FFFFFF", buttonRadius: 8, cardRadius: 8, thumbnailAspect: 1, thumbnailRadius: 6 });
  expect(sampleOf(storeThemes.boutique)).toMatchObject({ buttonRadius: 0, borderWidth: 0, thumbnailAspect: 4 / 5, thumbnailRadius: 0 });
  expect(sampleOf(storeThemes.antojo)).toMatchObject({ buttonRadius: 999, cardRadius: 20, borderWidth: 2, thumbnailRadius: 20 });
  expect(sampleOf(storeThemes.suave)).toMatchObject({ gradient: ["#F7DEDD", "#F5E8E0", "#EDE1D0"], thumbnailRadius: 999, buttonRadius: 16, borderWidth: 0 });
  expect(sampleOf(storeThemes.noche)).toMatchObject({ background: storeThemes.noche.colors.background, thumbnailAspect: 1, buttonRadius: 8 });
  for (const id of storeThemeIds) expect(sampleOf(storeThemes[id]).primary).toBe(storeThemes[id].colors.primary);
});

test("theme samples fail on a sampled value that is not in px", () => {
  const rem = { ...storeThemes.classic, style: { ...storeThemes.classic.style, "radius-button": "1rem" as CssValue } };
  expect(themeSample(rem)).toMatchObject({ success: false, error: { code: "UNSUPPORTED_UNIT" } });
  const border = { ...storeThemes.classic, style: { ...storeThemes.classic.style, "card-border": "0.1em solid red" as CssValue } };
  expect(themeSample(border)).toMatchObject({ success: false });
  const thumbnail = { ...storeThemes.classic, thumbnail: { ...storeThemes.classic.thumbnail, radius: "50%" as CssValue } };
  expect(themeSample(thumbnail)).toMatchObject({ success: false });
});
