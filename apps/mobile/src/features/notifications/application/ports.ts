import type { Result } from "@shared/result";
import type { RegisterPushDeviceRequest } from "@shared/contracts/push-devices";

export type NoticePermission = "granted" | "denied" | "undetermined";
export type NoticeLocale = RegisterPushDeviceRequest["locale"];
export type NoticeError = Readonly<{ code: "NOTICE_UNAVAILABLE" | "NETWORK_ERROR"; message: string }>;

export type NoticeGateway = Readonly<{
  /** `denied` also covers a refusal the system dialog cannot be shown again for. */
  permission: () => Promise<NoticePermission>;
  requestPermission: () => Promise<NoticePermission>;
  openSettings: () => Promise<void>;
  getToken: () => Promise<Result<string, NoticeError>>;
  dismissAll: () => Promise<void>;
}>;

export type StoredRegistration = Readonly<{ fingerprint: string; token: string }>;

export type NoticeStore = Readonly<{
  readRegistration: () => Promise<StoredRegistration | null>;
  writeRegistration: (registration: StoredRegistration) => Promise<void>;
  clearRegistration: () => Promise<void>;
  readPendingUnregister: () => Promise<string | null>;
  writePendingUnregister: (token: string) => Promise<void>;
  clearPendingUnregister: () => Promise<void>;
  wasPrompted: () => Promise<boolean>;
  markPrompted: () => Promise<void>;
}>;

export type PushDeviceApi = Readonly<{
  register: (request: RegisterPushDeviceRequest) => Promise<Result<null, NoticeError>>;
  /** Unauthenticated: the token is the proof. */
  unregister: (token: string) => Promise<Result<null, NoticeError>>;
}>;
