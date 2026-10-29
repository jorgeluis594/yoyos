import { z } from "zod";
import { peruWalletProviders } from "@shared/wallet-providers/peru";

/** The digital wallets a country offers, with the name each one is shown under. */
export type WalletProviderCatalog<Id extends string> = Readonly<{ ids: readonly [Id, ...Id[]]; labels: Readonly<Record<Id, string>> }>;

/** The one place where the country's wallets are chosen. */
const catalog: WalletProviderCatalog<(typeof peruWalletProviders.ids)[number]> = peruWalletProviders;

export type WalletProvider = (typeof catalog.ids)[number];
export const walletProviders: readonly WalletProvider[] = catalog.ids;
export const walletProviderSchema = z.enum(catalog.ids);

export function walletProviderLabel(provider: WalletProvider): string {
  return catalog.labels[provider];
}

/** What a seller picks for one payment: a wallet provider, or a bank transfer. */
export type PaymentChoice = WalletProvider | "bank_transfer";
export const defaultPaymentChoice: PaymentChoice = catalog.ids[0];
export const paymentChoices: readonly PaymentChoice[] = [...walletProviders, "bank_transfer"];

export type PaymentMethodAndProvider = Readonly<
  | { method: "digital_wallet"; walletProvider?: WalletProvider }
  | { method: "bank_transfer"; walletProvider?: undefined }>;

export function paymentFromChoice(choice: PaymentChoice): PaymentMethodAndProvider {
  return choice === "bank_transfer" ? { method: "bank_transfer" } : { method: "digital_wallet", walletProvider: choice };
}

/** The choice of a stored payment; a wallet payment saved without provider has none. */
export function choiceOfPayment(payment: Readonly<{ method: "digital_wallet" | "bank_transfer"; walletProvider?: WalletProvider | null }>): PaymentChoice | null {
  return payment.method === "bank_transfer" ? "bank_transfer" : payment.walletProvider ?? null;
}

export function isPaymentChoice(value: unknown): value is PaymentChoice {
  return paymentChoices.some((choice) => choice === value);
}

/** Whether the provider fits the method: only a digital wallet has one. */
export function walletProviderFitsMethod(payment: Readonly<{ method: string; walletProvider?: WalletProvider | null }>): boolean {
  return payment.walletProvider === undefined || payment.walletProvider === null || payment.method === "digital_wallet";
}
