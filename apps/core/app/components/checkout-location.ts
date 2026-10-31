import { isCompletePeruLocation, keepCoveredPeruPlace, settlePeruLocation, type PeruArea, type PeruAreaSelection } from "@shared/peru-geography";

type Filled = "none" | "partial" | "complete";
export type LocationNotice =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "preselected" }>
  | Readonly<{ kind: "cleared"; place: PeruArea; filled: Filled }>;
export type LocationStep = Readonly<{ location: PeruArea | null; notice: LocationNotice }>;

/** The fields appear (load, or entering home or agency from another method) with the form's last location. */
export function enterLocationMethod(places: PeruAreaSelection, current: PeruArea | null): LocationStep {
  const kept = current && keepCoveredPeruPlace(places, current);
  const { location, filled } = settlePeruLocation(places, kept);
  if (current && isCompletePeruLocation(current) && kept !== current) return { location, notice: { kind: "cleared", place: current, filled } };
  return { location, notice: filled === "none" ? { kind: "none" } : { kind: "preselected" } };
}

/** An upper level got a new value; the levels below were cleared by the control. */
export function chooseUpperLevel(places: PeruAreaSelection, next: PeruArea): LocationStep {
  const { location, filled } = settlePeruLocation(places, next);
  return { location, notice: filled === "none" ? { kind: "none" } : { kind: "preselected" } };
}
