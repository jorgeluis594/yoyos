/**
 * Counts every model call of an eval run by wrapping `fetch`, so the production clients (OpenAI, created inside the compositions)
 * and the Claude client are measured without changing their code. Installed before any client is created.
 */

export type ModelProvider = "openai" | "anthropic";
/** What a call was for: the system under test, or one of Claude's eval roles. */
export type CallRole = "system" | "judge" | "classifier" | "generator";

export type ModelCall = Readonly<{
  provider: ModelProvider;
  role: CallRole;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Part of `inputTokens` served from the provider's cache, and part of `outputTokens` spent reasoning; absent in older records. */
  cachedTokens?: number;
  reasoningTokens?: number;
  durationMs: number;
  status: number;
}>;

/**
 * USD per million tokens, as published by each provider. Checked on 2026-10-23: Claude Sonnet 5.5 from Anthropic's model table;
 * gpt-6-luna from third-party listings of OpenAI's price page (verify on developers.openai.com/api/docs/pricing). Embeddings by the
 * local SigLIP model cost nothing. A model missing here is reported with an unknown cost, never as free.
 */
export const modelPrices: Readonly<Record<string, Readonly<{ input: number; output: number }>>> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

/** Estimated cost of a call in USD, or null when the model has no configured price. */
export function costOf(call: Pick<ModelCall, "model" | "inputTokens" | "outputTokens">): number | null {
  const price = modelPrices[call.model];
  return price ? (call.inputTokens * price.input + call.outputTokens * price.output) / 1_000_000 : null;
}

const allCalls: ModelCall[] = [];

/**
 * Runs `work` and returns it with the model calls made meanwhile, tagged with `role`. Calls are taken by position in the process log
 * (the SDKs lose async context), so metered work must not overlap: eval cases run one at a time.
 */
export async function metered<T>(role: CallRole, work: () => Promise<T>): Promise<Readonly<{ value: T; calls: readonly ModelCall[] }>> {
  const start = allCalls.length;
  const value = await work();
  const calls = allCalls.slice(start).map((call) => ({ ...call, role }));
  return { value, calls };
}

/** Every call recorded in this process, metered or not. */
export const recordedCalls = (): readonly ModelCall[] => allCalls;

const providerOf = (url: string): ModelProvider | null =>
  url.startsWith("https://api.openai.com/") ? "openai" : url.startsWith("https://api.anthropic.com/") ? "anthropic" : null;

function requestModel(body: unknown): string {
  if (typeof body !== "string") return "unknown";
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    return typeof parsed.model === "string" ? parsed.model : "unknown";
  } catch {
    return "unknown";
  }
}

type Usage = Readonly<{ input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  input_tokens_details?: Readonly<{ cached_tokens?: number }>; prompt_tokens_details?: Readonly<{ cached_tokens?: number }>;
  output_tokens_details?: Readonly<{ reasoning_tokens?: number }>; completion_tokens_details?: Readonly<{ reasoning_tokens?: number }> }>;

/** Token counts of a JSON response body; Responses, Decisions and Messages use input/output, Chat and Embeddings prompt/completion. */
export function tokensOf(usage: Usage | undefined): Readonly<{ inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number }> {
  if (!usage) return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 };
  const input = (usage.input_tokens ?? usage.prompt_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return { inputTokens: input, outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0 };
}

async function usageOf(response: Response): Promise<Usage | undefined> {
  if (!response.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    return ((await response.clone().json()) as { usage?: Usage }).usage;
  } catch {
    return undefined;
  }
}

let installed = false;

/** Wraps the global `fetch` once per process. Request and response bodies are never stored or logged, only model names and counts. */
export function installModelMeter(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const provider = providerOf(url);
    if (!provider) return original(input, init);
    const started = performance.now();
    const response = await original(input, init);
    const tokens = tokensOf(await usageOf(response));
    const call: ModelCall = { provider, role: "system", endpoint: new URL(url).pathname, model: requestModel(init?.body),
      durationMs: Math.round(performance.now() - started), status: response.status, ...tokens };
    allCalls.push(call);
    return response;
  };
}
