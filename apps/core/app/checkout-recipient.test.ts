import { describe, expect, test } from "vitest";
import { checkoutFormSchema, otherPersonReceives } from "@core/app/checkout-recipient";

const buyer = { name: "Ana", phone: "+51977909427" };

test("a delivery saved for the buyer opens with the check unchecked", () => {
  expect(otherPersonReceives({ name: "Ana", phone: "+51977909427" }, buyer)).toBe(false);
  expect(otherPersonReceives({ name: " Ana ", phone: "+51977909427" }, buyer)).toBe(false);
});

test("the same person written two ways opens unticked", () => {
  expect(otherPersonReceives({ name: " Ana ", phone: "987654321" }, { name: "Ana", phone: "+51987654321" })).toBe(false);
  expect(otherPersonReceives({ name: "Ana", phone: "+51987654321" }, { name: "Ana", phone: "987 654 321" })).toBe(false);
  expect(otherPersonReceives({ name: "Ana", phone: "987654322" }, { name: "Ana", phone: "+51987654321" })).toBe(true);
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

describe("checkout form", () => {
  const form = { name: "Ana", phone: "+51977909427", otherRecipient: false, recipientName: "", recipientPhone: "" };
  const paths = (value: unknown) => { const result = checkoutFormSchema.safeParse(value); return result.success ? [] : result.error.issues.map(issue => issue.path.join(".")); };

  test("ignores the recipient fields when nobody else receives", () => {
    expect(paths(form)).toEqual([]);
  });

  test("asks for the recipient's name and phone together when someone else receives", () => {
    expect(paths({ ...form, otherRecipient: true })).toEqual(["recipientName", "recipientPhone"]);
    expect(paths({ ...form, otherRecipient: true, recipientName: "Luis", recipientPhone: "+14155552671" })).toEqual([]);
  });

  test("reports the buyer's and the recipient's errors at once", () => {
    expect(paths({ ...form, name: " ", otherRecipient: true, recipientName: "" })).toEqual(expect.arrayContaining(["name", "recipientName", "recipientPhone"]));
  });
});
