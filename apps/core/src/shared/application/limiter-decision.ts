export type LimiterDecision = Readonly<{ allowed: true }> | Readonly<{ allowed: false; retryAfterSeconds: number }>;
