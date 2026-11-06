import {
  proposalsFromImporter,
  validateProposals,
  type PlanningContext,
  type Proposal,
  type ProposalConflictReason,
} from "@/lib/bookings/plan";
import { AiQuotaExceededError, isAiQuotaExceeded } from "@/lib/ai/quota-client";

export type PlanningResult = {
  valid: Proposal[];
  conflicts: { proposal: Proposal; reason: ProposalConflictReason }[];
  importerConflicts: { date: string; reason: string }[];
};

function readImporterConflicts(raw: unknown): { date: string; reason: string }[] {
  const list = raw && typeof raw === "object" ? (raw as { conflicts?: unknown }).conflicts : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is { date: string; reason: string } =>
      !!c && typeof c === "object" && typeof (c as { date?: unknown }).date === "string" && typeof (c as { reason?: unknown }).reason === "string")
    .map((c) => ({ date: c.date, reason: c.reason.slice(0, 300) }));
}

/**
 * Tachi's planning request (`/api/import` in planning mode, registered users only): the
 * proposals that fit the context, the ones that do not, and the conflicts the model reported.
 * Throws when the request fails (including a model timeout), so the caller can offer a retry;
 * an AiQuotaExceededError when today's AI quota is used up.
 */
export async function requestPlanning(input: {
  context: PlanningContext;
  request?: string;
  lang: string;
  headers: HeadersInit;
}): Promise<PlanningResult> {
  const request = input.request?.trim();
  const response = await fetch("/api/import", {
    method: "POST",
    headers: input.headers,
    body: JSON.stringify({
      fallbackDate: input.context.days[0]?.date,
      lang: input.lang,
      planning: { context: input.context, ...(request ? { request } : {}) },
    }),
  });
  if (await isAiQuotaExceeded(response)) throw new AiQuotaExceededError();
  if (!response.ok) throw new Error(`status ${response.status}`);
  const data: unknown = await response.json();
  const { valid, conflicts } = validateProposals(proposalsFromImporter(data), input.context);
  return { valid, conflicts, importerConflicts: readImporterConflicts(data) };
}
