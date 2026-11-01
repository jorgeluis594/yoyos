import type { PaymentSettingsResponse } from "@shared/contracts/payment-settings";
import { paymentChoices, walletProviderLabel, walletProviders, type PaymentChoice, type PaymentMethodAndProvider, type WalletProvider } from "@shared/wallet-providers";

/** What the seller picks for one payment: a catalog choice, or the company's own wallet when its name is not in the catalog. */
export type OfferedChoice = PaymentChoice | "digital_wallet";

/** The payment choices a sale offers, following the company's payment settings. */
export type PaymentOptions = Readonly<{
  choices: readonly [OfferedChoice, ...OfferedChoice[]];
  /** The name the settings give the wallet, shown for the "digital_wallet" choice. */
  walletName: string | null;
  /** The company offers no method yet: the sale offers the whole catalog and points to the settings. */
  unconfigured: boolean;
}>;

const [firstCatalogChoice, ...otherCatalogChoices] = paymentChoices;
/** Every catalog choice, used while the settings are unknown. */
export const catalogPaymentOptions: PaymentOptions = { choices: [firstCatalogChoice ?? "bank_transfer", ...otherCatalogChoices], walletName: null, unconfigured: false };

const comparable = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** The settings name the wallet in free text: a name of the catalog becomes its provider, any other stays the company's own wallet. */
function walletChoice(name: string): OfferedChoice {
  return walletProviders.find(provider => comparable(walletProviderLabel(provider)) === comparable(name)) ?? "digital_wallet";
}

export function paymentOptionsOf(settings: PaymentSettingsResponse["settings"]): PaymentOptions {
  const wallet = settings.find(setting => setting.method === "digital_wallet");
  const choices: OfferedChoice[] = [...(wallet ? [walletChoice(wallet.provider)] : []), ...(settings.some(setting => setting.method === "bank_transfer") ? ["bank_transfer" as const] : [])];
  const [first, ...rest] = choices;
  if (!first) return { ...catalogPaymentOptions, unconfigured: true };
  return { choices: [first, ...rest], walletName: wallet ? wallet.provider.trim() : null, unconfigured: false };
}

export function offeredPayment(choice: OfferedChoice): PaymentMethodAndProvider {
  return choice === "bank_transfer" ? { method: "bank_transfer" } : choice === "digital_wallet" ? { method: "digital_wallet" } : { method: "digital_wallet", walletProvider: choice };
}

/** The choice a payment draft holds; a wallet without provider is the company's own wallet. */
export function offeredChoiceOf(payment: Readonly<{ method: "digital_wallet" | "bank_transfer"; walletProvider?: WalletProvider | null }>): OfferedChoice {
  return payment.method === "bank_transfer" ? "bank_transfer" : payment.walletProvider ?? "digital_wallet";
}

/** The name a choice is shown under; bank transfer and an unnamed wallet take their translated texts. */
export function offeredChoiceName(choice: OfferedChoice, options: PaymentOptions, texts: Readonly<{ wallet: string; bankTransfer: string }>): string {
  return choice === "bank_transfer" ? texts.bankTransfer : choice === "digital_wallet" ? options.walletName ?? texts.wallet : walletProviderLabel(choice);
}
