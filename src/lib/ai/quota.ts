import { NextResponse } from "next/server";

/**
 * Daily AI quotas per registered user (S1-S3, odd/tasks/ai-rate-limits.md).
 *
 * Single source of truth on the app side. src/lib/ai_usage_migration.sql keeps the same
 * numbers inside consume_ai_quota() (the limit is never sent by the client) and a test fails
 * when the two drift apart. Text import and planning share "import"; booking extraction and
 * code detection share "bookings". The day resets at 00:00 UTC.
 */
export const AI_QUOTA_LIMITS = {
  chat: 100,
  import: 20,
  bookings: 30,
  packing: 20,
  day_genius: 20,
  summary: 10,
  caption: 50,
} as const;

export type AiQuotaBucket = keyof typeof AI_QUOTA_LIMITS;

export const AI_QUOTA_EXCEEDED = "ai_quota_exceeded";

type RpcError = { code?: string; message?: string; status?: number } | null;
type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError; status?: number }>;
};

export type AiQuotaResult =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: "exceeded" | "unavailable" };

let warnedMissingFunction = false;

/**
 * PostgREST "function not found" (PGRST202) or Postgres undefined_function (42883): the migration
 * is not applied yet. Matched by code only: PostgREST also answers 404 for other errors (a missing
 * table, no data found), and those must fail closed, not open.
 */
function isMissingFunction(error: NonNullable<RpcError>): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

/**
 * Counts one AI request for the caller. Must receive the caller's own auth client
 * (getAuthClient(req)) so the SQL function sees the caller as auth.uid().
 *
 * Failure policy:
 * - Function missing (migration not applied yet): allow and log once (fail open), so deploying
 *   the code before running the migration does not lock everyone out of Tachi.
 * - Any other error: deny with 503 (fail closed), like the existing chat throttle; otherwise a
 *   database hiccup would silently remove the quota and its cost protection.
 */
export async function consumeAiQuota(client: RpcClient, bucket: AiQuotaBucket): Promise<AiQuotaResult> {
  let result: Awaited<ReturnType<RpcClient["rpc"]>>;
  try {
    result = await client.rpc("consume_ai_quota", { p_bucket: bucket });
  } catch (error) {
    console.error("AI quota check failed:", error instanceof Error ? error.message : "unknown error");
    return { allowed: false, reason: "unavailable" };
  }

  const { data, error } = result;
  if (error) {
    if (isMissingFunction(error)) {
      if (!warnedMissingFunction) {
        warnedMissingFunction = true;
        console.warn("AI quota disabled: consume_ai_quota is missing (run src/lib/ai_usage_migration.sql).");
      }
      return { allowed: true, remaining: null };
    }
    console.error("AI quota check failed:", error.message ?? error.code ?? "unknown error");
    return { allowed: false, reason: "unavailable" };
  }

  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; remaining?: unknown } | null | undefined;
  if (!row || typeof row.allowed !== "boolean") {
    console.error("AI quota check returned an unexpected shape");
    return { allowed: false, reason: "unavailable" };
  }
  if (!row.allowed) return { allowed: false, reason: "exceeded" };
  return { allowed: true, remaining: typeof row.remaining === "number" ? row.remaining : null };
}

/** Seconds until the next 00:00 UTC (when every quota resets); at least 1. */
export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export function aiQuotaExceededResponse(bucket: AiQuotaBucket, now: Date = new Date()) {
  return NextResponse.json(
    { error: AI_QUOTA_EXCEEDED, bucket, limit: AI_QUOTA_LIMITS[bucket] },
    { status: 429, headers: { "Retry-After": String(secondsUntilUtcMidnight(now)) } },
  );
}

/**
 * Route guard: null when the AI call may proceed, otherwise the response to return
 * (429 over the quota, 503 when the quota cannot be checked).
 */
export async function enforceAiQuota(client: RpcClient, bucket: AiQuotaBucket): Promise<NextResponse | null> {
  const result = await consumeAiQuota(client, bucket);
  if (result.allowed) return null;
  if (result.reason === "exceeded") return aiQuotaExceededResponse(bucket);
  return NextResponse.json({ error: "ai_quota_unavailable" }, { status: 503 });
}

/** Test hook: forget the "missing function" warning. */
export function resetAiQuotaWarningsForTests() {
  warnedMissingFunction = false;
}
