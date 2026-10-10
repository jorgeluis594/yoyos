import { err } from "@shared/functional";
import type { Result } from "@shared/result";
import type { WhatsAppClient, WhatsAppError } from "@mobile/modules/whatsapp/types";
import { resolveWhatsAppOptions, type WhatsAppConfigurationError } from "./whatsapp-options";

export type WhatsAppComposition = {
  readonly client: WhatsAppClient;
  /** Applies the configured budgets; an invalid setting fails here, before the module is touched. */
  initialize(): Promise<Result<void, WhatsAppError | WhatsAppConfigurationError>>;
};

export function createWhatsAppComposition(client: WhatsAppClient, recoveryBufferMib: string | undefined): WhatsAppComposition {
  return {
    client,
    initialize: async () => {
      const options = resolveWhatsAppOptions(recoveryBufferMib);
      if (!options.success) return err(options.error);
      return client.initialize(options.data);
    },
  };
}
