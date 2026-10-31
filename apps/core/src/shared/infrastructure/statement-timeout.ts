const statementTimeoutCode = "57014";

/** The statement timeout of PostgreSQL, whichever layer of the driver reports it. */
export function isStatementTimeout(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const { code, message, meta, cause: inner } = cause as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  const metaText = meta === undefined ? "" : JSON.stringify(meta);
  return code === statementTimeoutCode || metaText.includes(statementTimeoutCode)
    || (typeof message === "string" && message.includes("statement timeout")) || metaText.includes("statement timeout") || isStatementTimeout(inner);
}
