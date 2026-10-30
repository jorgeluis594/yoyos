import { expect, test } from "vitest";
import { canonicalPeruArea, type PeruArea, type PeruAreaSelection } from "@shared/peru-geography";
import { chooseUpperLevel, enterLocationMethod, isNewUpperLevel } from "@core/app/components/checkout-location";

const area = (codes: Partial<{ departmentCodes: string[]; provinceCodes: string[]; districtCodes: string[] }>): PeruAreaSelection =>
  canonicalPeruArea({ departmentCodes: [], provinceCodes: [], districtCodes: [], ...codes });
const district = (code: string) => ({ kind: "district", code }) as PeruArea;

test("entering a method keeps a covered district without notice", () => {
  const step = enterLocationMethod(area({ provinceCodes: ["1501"] }), district("150122"));
  expect(step).toEqual({ location: district("150122"), notice: { kind: "none" } });
});

test("entering agency from Miraflores clears it, preselects Arequipa and reports cleared with levels filled", () => {
  const step = enterLocationMethod(area({ departmentCodes: ["04"] }), district("150122"));
  expect(step.location).toEqual({ kind: "department", code: "04" });
  expect(step.notice).toEqual({ kind: "cleared", place: district("150122"), filled: "partial" });
});

test("entering agency where a single district is covered preselects it and reports cleared with district filled", () => {
  const step = enterLocationMethod(area({ districtCodes: ["040129"] }), district("150122"));
  expect(step.location).toEqual(district("040129"));
  expect(step.notice).toEqual({ kind: "cleared", place: district("150122"), filled: "complete" });
});

test("entering a method keeps a covered department when the province left on the form is not covered", () => {
  const step = enterLocationMethod(area({ provinceCodes: ["1501"] }), { kind: "province", code: "1504" } as PeruArea);
  expect(step.location).toEqual({ kind: "province", code: "1501" });
  expect(step.notice).toEqual({ kind: "preselected" });
});

test("entering a method with a cleared district keeps the covered department and province and preselects below", () => {
  const step = enterLocationMethod(area({ districtCodes: ["150122"] }), { kind: "province", code: "1501" } as PeruArea);
  expect(step.location).toEqual(district("150122"));
  expect(step.notice).toEqual({ kind: "preselected" });
});

test("entering home from a saved district outside coverage reports it cleared and preselects Lima and Lima", () => {
  const step = enterLocationMethod(area({ provinceCodes: ["1501"] }), district("150506"));
  expect(step.location).toEqual({ kind: "province", code: "1501" });
  expect(step.notice).toEqual({ kind: "cleared", place: district("150506"), filled: "partial" });
});

test("entering a method with nothing to preselect and no place leaves an empty notice", () => {
  const step = enterLocationMethod(area({ departmentCodes: ["15", "04"] }), null);
  expect(step).toEqual({ location: null, notice: { kind: "none" } });
});

test("entering a method clears the district and preselects nothing when several choices remain", () => {
  const step = enterLocationMethod(area({ departmentCodes: ["15", "04"] }), district("080101"));
  expect(step).toEqual({ location: null, notice: { kind: "cleared", place: district("080101"), filled: "none" } });
});

test("choosing a new department preselects a single province and district and reports preselected", () => {
  const step = chooseUpperLevel(area({ districtCodes: ["150122", "040129"] }), { kind: "department", code: "04" } as PeruArea);
  expect(step).toEqual({ location: district("040129"), notice: { kind: "preselected" } });
});

test("choosing an upper level with several choices below reports no notice", () => {
  const step = chooseUpperLevel(area({ departmentCodes: ["15", "04"] }), { kind: "department", code: "04" } as PeruArea);
  expect(step).toEqual({ location: { kind: "department", code: "04" }, notice: { kind: "none" } });
});

test("only a new department or province value counts as an upper-level choice", () => {
  const miraflores = district("150122");
  expect(isNewUpperLevel(miraflores, { kind: "department", code: "04" } as PeruArea, "department")).toBe(true);
  expect(isNewUpperLevel(miraflores, { kind: "department", code: "15" } as PeruArea, "department")).toBe(false);
  expect(isNewUpperLevel(null, { kind: "province", code: "1501" } as PeruArea, "province")).toBe(true);
  expect(isNewUpperLevel({ kind: "department", code: "15" } as PeruArea, { kind: "department", code: "15" } as PeruArea, "province")).toBe(false);
  expect(isNewUpperLevel(miraflores, { kind: "department", code: "15" } as PeruArea, "province")).toBe(false);
  expect(isNewUpperLevel(miraflores, district("150101"), "district")).toBe(false);
});
