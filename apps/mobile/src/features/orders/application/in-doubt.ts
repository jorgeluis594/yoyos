import type { Result } from "@shared/result";

/** Answers that may have been lost after the request left: the write may or may not have happened. */
const lostAnswerCodes = new Set<string>(["NETWORK_ERROR", "SERVER_ERROR", "INTERNAL_ERROR", "INVALID_RESPONSE"]);
export const isLostAnswer = (code: string) => lostAnswerCodes.has(code);

/** Waits before the first and second repeat. */
export const defaultRepeatDelays: readonly number[] = [300, 1200];
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Repeats an idempotent write (the same client id) while its answer may have been lost. Definite answers, success or refusal, return at once.
 * When every repeat is lost, the last error returns.
 */
export async function repeatWhileInDoubt<T, E extends Readonly<{ code: string; message: string }>>(
  attempt: () => Promise<Result<T, E>>,
  options: Readonly<{ onInDoubt: () => void; wait?: (ms: number) => Promise<void>; delays?: readonly number[] }>,
): Promise<Result<T, E>> {
  const wait = options.wait ?? sleep;
  let result = await attempt();
  let announced = false;
  for (const delay of options.delays ?? defaultRepeatDelays) {
    if (result.success || !isLostAnswer(result.error.code)) return result;
    if (!announced) { options.onInDoubt(); announced = true; }
    await wait(delay);
    result = await attempt();
  }
  return result;
}
