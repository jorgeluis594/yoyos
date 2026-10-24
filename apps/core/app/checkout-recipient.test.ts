import { expect, test } from "vitest";
import { otherPersonReceives } from "@core/app/checkout-recipient";

const buyer = { name: "Ana", phone: "+51977909427" };

test("a delivery saved for the buyer opens with the check unchecked", () => {
  expect(otherPersonReceives({ name: "Ana", phone: "+51977909427" }, buyer)).toBe(false);
  expect(otherPersonReceives({ name: " Ana ", phone: "+51977909427" }, buyer)).toBe(false);
});

test("a delivery saved for someone else opens with the check checked", () => {
  expect(otherPersonReceives({ name: "Luis", phone: "+51977909427" }, buyer)).toBe(true);
  expect(otherPersonReceives({ name: "Ana", phone: "+14155552671" }, buyer)).toBe(true);
});

test("without a saved delivery nobody else receives", () => {
  expect(otherPersonReceives(null, buyer)).toBe(false);
  expect(otherPersonReceives(undefined, null)).toBe(false);
});

test("a saved delivery with no buyer data yet differs from the buyer", () => {
  expect(otherPersonReceives({ name: "Luis", phone: "999" }, null)).toBe(true);
  expect(otherPersonReceives({ name: "Luis", phone: "999" }, { name: null, phone: null })).toBe(true);
});
