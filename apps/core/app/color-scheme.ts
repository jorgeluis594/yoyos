/** What a route declares about the page's color scheme: `"fixed"` pages render a checkout theme and ignore the buyer's preference. */
export type ColorScheme = "fixed" | "system";
export type ColorSchemeHandle = Readonly<{ colorScheme: (loaderData: unknown) => ColorScheme }>;

type RouteMatch = Readonly<{ handle?: unknown; data?: unknown }>;

const hasColorScheme = (handle: unknown): handle is ColorSchemeHandle =>
  typeof handle === "object" && handle !== null && "colorScheme" in handle && typeof handle.colorScheme === "function";

/** The deepest matched route decides; a route without the handle follows the system or the stored preference. */
export function colorSchemeOf(matches: readonly RouteMatch[]): ColorScheme {
  const route = matches.at(-1);
  return route && hasColorScheme(route.handle) ? route.handle.colorScheme(route.data) : "system";
}

/** Applies the buyer's or seller's preference to `<html>`; a `"fixed"` page leaves `.dark` off (a theme paints its own mode). */
export function applyColorPreference(root: HTMLElement, preference: string | null, systemDark: boolean): void {
  if (root.dataset.colorScheme === "fixed") root.classList.remove("dark");
  else root.classList.toggle("dark", preference === "dark" || (!preference && systemDark));
}

/** The same rule as `applyColorPreference`, as the head script that runs before hydration. */
export const applyPreferenceScript = `const root = document.documentElement;
if (root.dataset.colorScheme === 'fixed') root.classList.remove('dark');
else {
  const preference = localStorage.getItem('yoyos-theme');
  root.classList.toggle('dark', preference === 'dark' || (!preference && matchMedia('(prefers-color-scheme: dark)').matches));
}`;
