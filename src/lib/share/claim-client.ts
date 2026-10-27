import { authHeaders } from "@/lib/auth-headers";

/** Never hold the trips back for long: the invitations can be claimed on the next sign-in. */
const CLAIM_TIMEOUT_MS = 6000;

/** Grants the signed-in user the invitations sent to their email; failures are ignored. */
export async function claimPendingInvitations(): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS);
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return [];
    const response = await fetch("/api/share/claim", { method: "POST", headers, signal: controller.signal });
    if (!response.ok) return [];
    const data = (await response.json()) as { tripIds?: unknown };
    return Array.isArray(data.tripIds) ? data.tripIds.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
