import { add, compare, divide, multiply, subtract } from "@shared/money";
import type { Money, MoneyError } from "@shared/money";
import type { Result } from "@shared/result";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// Exact public contracts: Decimal must not leak into inputs or outputs.
export type MoneyContracts = [
  Assert<Equal<Money, { readonly amount: number; readonly currency: string }>>,
  Assert<Equal<typeof add, (other: Money) => (current: Money) => Result<Money, MoneyError>>>,
  Assert<Equal<typeof subtract, (other: Money) => (current: Money) => Result<Money, MoneyError>>>,
  Assert<Equal<typeof multiply, (money: Money) => (factor: number) => Result<Money, MoneyError>>>,
  Assert<Equal<typeof divide, (money: Money) => (divisor: number) => Result<Money, MoneyError>>>,
  Assert<Equal<typeof compare, (other: Money) => (current: Money) => Result<-1 | 0 | 1, MoneyError>>>,
];
