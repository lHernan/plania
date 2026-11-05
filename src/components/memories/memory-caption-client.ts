import { authHeaders } from "@/lib/auth-headers";

export type CaptionRequest = { tripId: string; activityTitle?: string; city?: string; note?: string; lang: string };
export type CaptionResult = { caption: string } | { error: "offline" | "failed" };

/** Asks the caption route for a text-only suggestion (registered users only). */
export async function requestMemoryCaption(input: CaptionRequest): Promise<CaptionResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { error: "offline" };
  try {
    const response = await fetch("/api/memories/caption", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as { caption?: unknown } | null;
    if (!response.ok || typeof body?.caption !== "string" || !body.caption) return { error: "failed" };
    return { caption: body.caption };
  } catch {
    return { error: "failed" };
  }
}
