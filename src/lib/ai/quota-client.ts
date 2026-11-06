/**
 * Client side of the daily AI quotas: every AI caller uses these instead of parsing the 429
 * itself, and shows t(AI_QUOTA_MESSAGE_KEY) ("ai_quota_exceeded" in the locale files).
 */
export const AI_QUOTA_EXCEEDED = "ai_quota_exceeded";
export const AI_QUOTA_MESSAGE_KEY = "ai_quota_exceeded";

/**
 * True when the route answered 429 because today's AI quota is used up (not another 429, such
 * as the chat's short-term throttle). Reads a clone, so the caller can still read the body.
 */
export async function isAiQuotaExceeded(response: Response): Promise<boolean> {
  if (response.status !== 429) return false;
  try {
    const body = (await response.clone().json()) as { error?: unknown } | null;
    return body?.error === AI_QUOTA_EXCEEDED;
  } catch {
    return false;
  }
}

/** Error thrown by callers that surface failures as exceptions. */
export class AiQuotaExceededError extends Error {
  constructor() {
    super(AI_QUOTA_EXCEEDED);
    this.name = "AiQuotaExceededError";
  }
}

export function isAiQuotaExceededError(error: unknown): boolean {
  return error instanceof AiQuotaExceededError;
}
