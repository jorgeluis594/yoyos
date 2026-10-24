import type { Result } from "@shared/result";

export type UnregisterPushDeviceDependencies = Readonly<{
  removeByToken: (token: string) => Promise<Result<null, Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string }>>>;
}>;

/** The token is the proof, so any string is accepted: an unknown or malformed token simply deletes nothing. */
export function unregisterPushDevice(input: Readonly<{ token: string }>, deps: UnregisterPushDeviceDependencies) {
  return deps.removeByToken(input.token);
}
