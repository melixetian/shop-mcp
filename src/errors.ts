export class AppError extends Error {
  constructor(public readonly publicMessage: string, cause?: unknown) {
    super(publicMessage, { cause });
    this.name = "AppError";
  }
}

export function safeSqlError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : "Invalid query.";
  // SQLite errors are useful to agents, but avoid leaking file paths or driver details.
  const sanitized = message.replace(/(?:\/[^\s:]+)+/g, "[path]").slice(0, 500);
  return new AppError(`SQL error: ${sanitized}`);
}
