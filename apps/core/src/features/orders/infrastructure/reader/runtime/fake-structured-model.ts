import type { ModelUsage, ReaderStage } from "@core/src/features/orders/domain/reader/readings";
import type { StageError } from "@core/src/features/orders/application/reader/stages";
import { failureOf, type StructuredModel, type StructuredModelRequest } from "@core/src/features/orders/infrastructure/reader/runtime/structured-model";

export type FakeStageAnswer = Readonly<{ json: unknown; usage?: ModelUsage }> | Readonly<{ error: StageError["code"] }>;
export type FakeStructuredModel = StructuredModel & Readonly<{ requests: readonly StructuredModelRequest[] }>;

/** A scripted model for tests: each stage answers its scripted answers in order, and fails once they run out. Refused in production. */
export function createFakeStructuredModel(answers: Partial<Record<ReaderStage, readonly FakeStageAnswer[]>>, nodeEnv: string | undefined = process.env.NODE_ENV): FakeStructuredModel {
  if (nodeEnv === "production") throw new Error("The fake structured model is refused in production");
  const queues = new Map(Object.entries(answers).map(([stage, scripted]) => [stage, [...scripted]]));
  const requests: StructuredModelRequest[] = [];
  const model: StructuredModel = async (request) => {
    requests.push(request);
    const next = queues.get(request.stage)?.shift();
    if (!next) return failureOf(request, "AI_PROVIDER_UNAVAILABLE", "The fake model has no scripted answer left");
    if ("error" in next) return failureOf(request, next.error, "The fake model was scripted to fail");
    return { success: true, data: { json: next.json, usage: next.usage ?? null } };
  };
  return Object.assign(model, { requests });
}
