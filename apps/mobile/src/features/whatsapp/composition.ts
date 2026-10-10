import type { Result } from "@shared/result";
import type { Clock, GatewayConfigurationError, Session, WhatsAppGateway } from "@mobile/features/whatsapp/application/ports";
import { linkAccount, unlinkAccount } from "@mobile/features/whatsapp/application/link-account";
import { createReceptionLifecycle } from "@mobile/features/whatsapp/application/reception-lifecycle";
import { receiveMessage } from "@mobile/features/whatsapp/application/receive-message";
import { createSyncWorker } from "@mobile/features/whatsapp/application/sync-messages";
import { releaseImage, viewImage } from "@mobile/features/whatsapp/application/view-image";
import type { CompanyId, UserId } from "@mobile/features/whatsapp/domain/ids";
import { createLocalSql, type SqlDatabase } from "@mobile/features/whatsapp/infrastructure/local-sql";
import { createMessageApi } from "@mobile/features/whatsapp/infrastructure/message-api";
import { createSqliteLinkStore } from "@mobile/features/whatsapp/infrastructure/sqlite-link-store";
import { createSqliteMessageStore } from "@mobile/features/whatsapp/infrastructure/sqlite-message-store";
import type { TransportError } from "@mobile/shared/application/transport-error";

export type WhatsAppRuntimeDeps = Readonly<{
  database: SqlDatabase;
  request: (path: string, init?: RequestInit) => Promise<Result<unknown, TransportError>>;
  gateway: WhatsAppGateway;
  /** Yoyos session generation; changes on every sign-in and sign-out. */
  generation: () => number;
  newId: () => string;
  now: Clock;
  random: () => number;
  schedule: (ms: number, run: () => void) => () => void;
}>;

export type SessionIdentity = Readonly<{ companyId: string; userId: string }>;

/** Wires the feature's use cases to concrete adapters. The identity of the signed-in user is supplied by presentation. */
export function createWhatsAppRuntime(deps: WhatsAppRuntimeDeps) {
  const sql = createLocalSql(deps.database);
  const store = createSqliteMessageStore(sql);
  const links = createSqliteLinkStore(sql, deps.newId);
  let identity: SessionIdentity | null = null;
  const session = (): Session | null => identity === null ? null : {
    companyId: identity.companyId as CompanyId, userId: identity.userId as UserId, generation: deps.generation(),
  };

  const sync = createSyncWorker({ store, api: createMessageApi(deps.request), session, now: deps.now, random: deps.random, schedule: deps.schedule });
  const receive = receiveMessage({ store, links, whatsapp: deps.gateway, now: deps.now, wakeSync: sync.wake });
  const reception = createReceptionLifecycle({ whatsapp: deps.gateway, links, session, receive, sync });

  return {
    store,
    links,
    sync,
    reception,
    session,
    setIdentity(next: SessionIdentity | null) { identity = next; },
    linkAccount: linkAccount({ links, session, now: deps.now, startReception: reception.start }),
    unlinkAccount: unlinkAccount({ links, whatsapp: deps.gateway, now: deps.now }),
    viewImage: viewImage({ store, whatsapp: deps.gateway }),
    releaseImage: releaseImage({ whatsapp: deps.gateway }),
  } as const;
}

export type WhatsAppRuntime = ReturnType<typeof createWhatsAppRuntime>;
export type { GatewayConfigurationError };
