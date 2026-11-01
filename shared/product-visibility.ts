/** What a product save sends for visibility: nothing when the switch shows the loaded value, otherwise the value the seller chose. */
export type VisibilityToSave = Readonly<{ kind: "unchanged" }> | Readonly<{ kind: "set"; hidden: boolean }>;

/** Toggling the switch and toggling it back counts as unchanged, so a stale form never overwrites what another device set. */
export function visibilityToSave(loaded: boolean, current: boolean): VisibilityToSave {
  return current === loaded ? { kind: "unchanged" } : { kind: "set", hidden: current };
}
