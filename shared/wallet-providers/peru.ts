import type { WalletProviderCatalog } from "@shared/wallet-providers";

const ids = ["yape", "plin"] as const;

/** Digital wallets used in Peru; Yape and Plin are proper names, so they are never translated. */
export const peruWalletProviders: WalletProviderCatalog<(typeof ids)[number]> = { ids, labels: { yape: "Yape", plin: "Plin" } };
