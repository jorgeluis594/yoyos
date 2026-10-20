import { expect, test } from "vitest";
import type { DeliveryRateContract, QuotedAgencyContract } from "@shared/contracts/quotations";
import { agencyChoices, buyerAgencyLabel, chosenAgency } from "@core/app/checkout-agency-choices";

const places = {
  cayma: { districtCode: "040103", district: "CAYMA", province: "AREQUIPA", department: "AREQUIPA" },
  yanahuara: { districtCode: "040126", district: "YANAHUARA", province: "AREQUIPA", department: "AREQUIPA" },
  mollendo: { districtCode: "040701", district: "MOLLENDO", province: "ISLAY", department: "AREQUIPA" },
  characato: "040105", callao: "070101",
  miraflores: { districtCode: "150122", district: "MIRAFLORES", province: "LIMA", department: "LIMA" },
};
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const agency = (n: number, name: string, courier: string, place: keyof typeof places & ("cayma" | "yanahuara" | "mollendo" | "miraflores"), address = "Av. Ejército 1020"): QuotedAgencyContract => ({
  id: id(n), name, address, courier: { id: id(n + 100), name: courier }, location: { country: "PE", ...places[place] },
});
const rate = (n: number, name: string, amount: number, agencies: QuotedAgencyContract[]): DeliveryRateContract => ({
  id: id(n), optionId: id(n + 50), name, zoneName: "Arequipa", price: { amount, currency: "PEN" }, method: "agency", agencies,
});
const cayma = agency(1, "Agencia Cayma", "Shalom", "cayma");
const yanahuara = agency(2, "Agencia Yanahuara", "Shalom", "yanahuara");
const olva = agency(3, "Olva Cayma", "Olva", "cayma");
const rates = [rate(10, "Shalom", 12, [cayma, yanahuara]), rate(11, "Olva", 10, [olva])];
const names = (result: ReturnType<typeof agencyChoices>) => result.level === "none" ? [] : result.choices.map(choice => choice.agency.name);

test("buyer in Cayma sees only the Cayma agencies, Olva at S/ 10.00 before Shalom at S/ 12.00, without Yanahuara", () => {
  const result = agencyChoices(rates, "040103");
  expect(result.level).toBe("district");
  expect(names(result)).toEqual(["Olva Cayma", "Agencia Cayma"]);
});

test("buyer in Characato falls back to the province agencies ordered by price and then agency name", () => {
  const result = agencyChoices(rates, places.characato);
  expect(result.level).toBe("province");
  expect(names(result)).toEqual(["Olva Cayma", "Agencia Cayma", "Agencia Yanahuara"]);
});

test("buyer in Mollendo falls back to the department agencies located in Arequipa province", () => {
  const result = agencyChoices(rates, "040701");
  expect(result.level).toBe("department");
  expect(names(result)).toEqual(["Olva Cayma", "Agencia Cayma", "Agencia Yanahuara"]);
});

test("returns no agencies when the only quoted agency is outside the buyer department", () => {
  expect(agencyChoices([rate(10, "Shalom", 12, [agency(4, "Agencia Miraflores", "Shalom", "miraflores")])], "040701")).toEqual({ level: "none" });
});

test("a buyer in Callao never sees agencies located in Lima province", () => {
  expect(agencyChoices([rate(10, "Shalom", 12, [agency(4, "Agencia Miraflores", "Shalom", "miraflores")])], places.callao)).toEqual({ level: "none" });
});

test("returns no agencies when the quotation of the district has only home rates", () => {
  const home: DeliveryRateContract = { id: id(20), optionId: id(70), name: "Moto", zoneName: "Arequipa", price: { amount: 5, currency: "PEN" }, method: "home" };
  expect(agencyChoices([home], "040103")).toEqual({ level: "none" });
});

test("never adds agencies that the quotation did not return", () => {
  expect(agencyChoices([], "040103")).toEqual({ level: "none" });
  expect(names(agencyChoices([rate(10, "Shalom", 12, [cayma])], "040103"))).toEqual(["Agencia Cayma"]);
});

test("an agency in two options appears once with the cheaper option rate and price", () => {
  const result = agencyChoices([rates[0], rate(12, "Shalom express", 15, [cayma])], "040103");
  if (result.level === "none") throw new Error("expected choices");
  expect(result.choices).toHaveLength(1);
  expect(result.choices[0]).toMatchObject({ rateId: id(10), optionName: "Shalom", price: { amount: 12 } });
});

test("an agency in two options with equal price keeps the option whose name sorts first", () => {
  const result = agencyChoices([rate(12, "Zeta", 12, [cayma]), rate(13, "Alfa", 12, [cayma])], "040103");
  if (result.level === "none") throw new Error("expected choices");
  expect(result.choices[0]).toMatchObject({ rateId: id(13), optionName: "Alfa" });
});

test("orders agencies within a level by price, then agency name, then courier name", () => {
  const beta = agency(5, "Beta", "Zeta", "cayma");
  const alfaB = agency(6, "Alfa", "Zeta", "cayma");
  const alfaA = agency(7, "Alfa", "Alpha", "cayma");
  const result = agencyChoices([rate(10, "Opt", 12, [beta, alfaB, alfaA]), rate(11, "Cheap", 8, [cayma])], "040103");
  if (result.level === "none") throw new Error("expected choices");
  expect(result.choices.map(choice => choice.agency.id)).toEqual([cayma.id, alfaA.id, alfaB.id, beta.id]);
});

test("a single agency is chosen without a buyer selection", () => {
  const result = agencyChoices([rate(10, "Shalom", 12, [cayma])], "040103");
  expect(chosenAgency(result, "")?.agency.id).toBe(cayma.id);
});

test("a chosen agency missing from the requoted list leaves no choice", () => {
  expect(chosenAgency(agencyChoices(rates, "040103"), yanahuara.id)).toBeNull();
  expect(chosenAgency({ level: "none" }, cayma.id)).toBeNull();
});

test("a chosen agency keeps the buyer choice with the requoted price", () => {
  const requoted = [rate(10, "Shalom", 14, [cayma, yanahuara]), rates[1]];
  expect(chosenAgency(agencyChoices(requoted, "040103"), cayma.id)).toMatchObject({ agency: { id: cayma.id }, price: { amount: 14 } });
});

test("buyer label shows agency, courier, address, district, province and price, with zero as free", () => {
  const choice = (amount: number) => { const result = agencyChoices([rate(10, "Shalom", amount, [cayma])], "040103"); if (result.level === "none") throw new Error("expected"); return result.choices[0]; };
  const amount = (price: { amount: number }) => price.amount === 0 ? "Gratis" : `S/ ${price.amount.toFixed(2)}`;
  expect(buyerAgencyLabel(choice(12), amount)).toBe("Agencia Cayma · Shalom · Av. Ejército 1020 · CAYMA, AREQUIPA · S/ 12.00");
  expect(buyerAgencyLabel(choice(0), amount)).toMatch(/ · Gratis$/);
});
