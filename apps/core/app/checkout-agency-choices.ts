import type { DeliveryRateContract, QuotedAgencyContract } from "@shared/contracts/quotations";

type Money = DeliveryRateContract["price"];
export type AgencyChoice = Readonly<{ agency: QuotedAgencyContract; rateId: string; optionName: string; price: Money }>;
export type AgencyChoiceLevel = "district" | "province" | "department";
export type AgencyChoices =
  | Readonly<{ level: AgencyChoiceLevel; choices: readonly [AgencyChoice, ...AgencyChoice[]] }>
  | Readonly<{ level: "none" }>;

const compare = (a: string, b: string) => a.localeCompare(b, "es");
const prefixes = [["district", 6], ["province", 4], ["department", 2]] as const;

// Lower price wins; ties go to the option name, then the rate id, so the result is deterministic.
const better = (a: AgencyChoice, b: AgencyChoice) =>
  a.price.amount - b.price.amount || compare(a.optionName, b.optionName) || compare(a.rateId, b.rateId);
const inOrder = (a: AgencyChoice, b: AgencyChoice) =>
  a.price.amount - b.price.amount || compare(a.agency.name, b.agency.name) || compare(a.agency.courier.name, b.agency.courier.name) || compare(a.agency.id, b.agency.id);

export function agencyChoices(rates: readonly DeliveryRateContract[], districtCode: string): AgencyChoices {
  const byAgency = new Map<string, AgencyChoice>();
  for (const rate of rates) {
    if (rate.method !== "agency") continue;
    for (const agency of rate.agencies) {
      const choice = { agency, rateId: rate.id, optionName: rate.name, price: rate.price };
      const current = byAgency.get(agency.id);
      if (!current || better(choice, current) < 0) byAgency.set(agency.id, choice);
    }
  }
  const all = [...byAgency.values()];
  for (const [level, digits] of prefixes) {
    const [first, ...rest] = all
      .filter(choice => choice.agency.location.districtCode.slice(0, digits) === districtCode.slice(0, digits))
      .sort(inOrder);
    if (first) return { level, choices: [first, ...rest] };
  }
  return { level: "none" };
}

export function chosenAgency(choices: AgencyChoices, agencyId: string): AgencyChoice | null {
  if (choices.level === "none") return null;
  if (choices.choices.length === 1) return choices.choices[0];
  return choices.choices.find(choice => choice.agency.id === agencyId) ?? null;
}

export function buyerAgencyLabel(choice: AgencyChoice, amount: (price: Money) => string): string {
  const { agency } = choice;
  return `${agency.name} · ${agency.courier.name} · ${agency.address} · ${agency.location.district}, ${agency.location.province} · ${amount(choice.price)}`;
}
