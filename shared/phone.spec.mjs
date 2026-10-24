import { expect, test } from "vitest";
import { defaultPhoneCountry, internationalPhonePattern, joinPhone, phoneCountries, splitPhone } from "@shared/phone";

test("Peru is the default country and the list covers every country with a unique ISO code", () => {
  expect(defaultPhoneCountry).toBe("PE");
  expect(phoneCountries.find(country => country.iso === "PE")).toMatchObject({ dial: "51" });
  expect(new Set(phoneCountries.map(country => country.iso)).size).toBe(phoneCountries.length);
  expect(phoneCountries.length).toBeGreaterThan(220);
  for (const country of phoneCountries) expect(country.iso).toMatch(/^[A-Z]{2}$/);
});

test("joins the country and a national number typed with spaces or dashes into E.164 without separators", () => {
  expect(joinPhone("PE", "977 909 427")).toBe("+51977909427");
  expect(joinPhone("PE", "(977)-909-427")).toBe("+51977909427");
  expect(joinPhone("US", "415 555 2671")).toBe("+14155552671");
  expect(joinPhone("PE", "977909427")).toMatch(internationalPhonePattern);
});

test("an empty national number joins to an empty string so the required check fails in place", () => {
  expect(joinPhone("PE", "")).toBe("");
  expect(joinPhone("PE", "  -  ")).toBe("");
});

test("splits a saved Peruvian phone back into the default country and national digits (round trip)", () => {
  expect(splitPhone("+51977909427")).toEqual({ country: "PE", national: "977909427" });
  const split = splitPhone("+51977909427");
  expect(joinPhone(split.country, split.national)).toBe("+51977909427");
});

test("splits other countries by the longest matching dial code", () => {
  expect(splitPhone("+5491112345678")).toEqual({ country: "AR", national: "91112345678" });
  expect(splitPhone("+18765551234")).toEqual({ country: "JM", national: "5551234" });
  expect(splitPhone("+34612345678")).toEqual({ country: "ES", national: "612345678" });
});

test("ambiguous shared dial codes pick the main country", () => {
  expect(splitPhone("+14155552671")).toEqual({ country: "US", national: "4155552671" });
  expect(splitPhone("+447911123456")).toEqual({ country: "GB", national: "7911123456" });
  expect(splitPhone("+79123456789")).toEqual({ country: "RU", national: "9123456789" });
});

test("round-trips every dial code through split and join", () => {
  for (const country of phoneCountries) {
    const phone = `+${country.dial}12345678`;
    const split = splitPhone(phone);
    expect(split, country.iso).not.toBeNull();
    expect(joinPhone(split.country, split.national)).toBe(phone);
  }
});

test("accepts a phone typed with spaces and rejects text without a known country code", () => {
  expect(splitPhone("+51 977 909 427")).toEqual({ country: "PE", national: "977909427" });
  expect(splitPhone("977909427")).toBeNull();
  expect(splitPhone("")).toBeNull();
  expect(splitPhone("+")).toBeNull();
  expect(splitPhone("+999123")).toBeNull();
  expect(splitPhone("invalid")).toBeNull();
});
