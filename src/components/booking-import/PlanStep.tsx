"use client";

import { useId, useMemo, useState } from "react";
import { LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useItineraryStore } from "@/store/use-itinerary-store";
import {
  assessFeasibility,
  buildPlanningContext,
  proposalsFromImporter,
  validateProposals,
  type DayDensity,
  type FeasibilityAlternative,
  type PlanningContext,
  type Proposal,
  type ProposalConflictReason,
} from "@/lib/bookings/plan";
import { proposalsToActivities } from "@/lib/bookings/import-session";

const DENSITIES: DayDensity[] = ["light", "balanced", "full"];

type DraftProposal = Proposal & { key: string; accepted: boolean };

type Generated = {
  context: PlanningContext;
  proposals: DraftProposal[];
  rejected: { proposal: Proposal; reason: ProposalConflictReason }[];
  importerConflicts: { date: string; reason: string }[];
  skippedDays: string[];
};

type Infeasible = { blockedDays: string[]; alternatives: FeasibilityAlternative[] };

function readImporterConflicts(raw: unknown): { date: string; reason: string }[] {
  const list = raw && typeof raw === "object" ? (raw as { conflicts?: unknown }).conflicts : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is { date: string; reason: string } =>
      !!c && typeof c === "object" && typeof (c as { date?: unknown }).date === "string" && typeof (c as { reason?: unknown }).reason === "string")
    .map((c) => ({ date: c.date, reason: c.reason.slice(0, 300) }));
}

export function PlanStep({
  authHeaders,
  onSaved,
}: {
  authHeaders: () => Promise<HeadersInit>;
  onSaved: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const baseId = useId();
  const addActivitiesBatch = useItineraryStore((s) => s.addActivitiesBatch);
  const [density, setDensity] = useState<DayDensity>("balanced");
  const [wishes, setWishes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infeasible, setInfeasible] = useState<Infeasible | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    // Always plan from the current store trip: the bookings just saved are already in it.
    const trip = useItineraryStore.getState().activeTrip;
    if (!trip) return;
    setError(null);
    setInfeasible(null);
    const context = buildPlanningContext({
      tripName: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      days: trip.days,
      density,
    });
    const feasibility = assessFeasibility(context);
    if (!feasibility.feasible) {
      setGenerated(null);
      setInfeasible({ blockedDays: feasibility.blockedDays, alternatives: feasibility.alternatives });
      return;
    }

    setBusy(true);
    try {
      const request = wishes.trim();
      const response = await fetch("/api/import", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          fallbackDate: context.days[0]?.date,
          lang,
          planning: { context, ...(request ? { request } : {}) },
        }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data: unknown = await response.json();
      const { valid, conflicts } = validateProposals(proposalsFromImporter(data), context);
      setGenerated({
        context,
        proposals: valid.map((p, index) => ({ ...p, key: `${p.date}-${index}`, accepted: true })),
        rejected: conflicts,
        importerConflicts: readImporterConflicts(data),
        skippedDays: feasibility.blockedDays,
      });
    } catch {
      setError(t("booking_import_generate_failed"));
    } finally {
      setBusy(false);
    }
  };

  const accepted = useMemo(() => generated?.proposals.filter((p) => p.accepted) ?? [], [generated]);
  // Edited times are re-checked against the same commitments before anything is saved.
  const editConflicts = useMemo(() => {
    if (!generated) return new Set<string>();
    const { conflicts } = validateProposals(accepted, generated.context);
    return new Set(conflicts.map((c) => (c.proposal as DraftProposal).key));
  }, [accepted, generated]);

  const updateProposal = (key: string, patch: Partial<DraftProposal>) =>
    setGenerated((g) => (g ? { ...g, proposals: g.proposals.map((p) => (p.key === key ? { ...p, ...patch } : p)) } : g));
  const discardProposal = (key: string) =>
    setGenerated((g) => (g ? { ...g, proposals: g.proposals.filter((p) => p.key !== key) } : g));

  const accept = async () => {
    const trip = useItineraryStore.getState().activeTrip;
    if (!trip || accepted.length === 0 || editConflicts.size > 0) return;
    setSaving(true);
    setError(null);
    const proposals = accepted.map((p) => {
      const { key, accepted: _accepted, ...proposal } = p;
      void key;
      void _accepted;
      return proposal;
    });
    const result = await addActivitiesBatch(proposalsToActivities(proposals, trip.days));
    setSaving(false);
    if (result.ok) onSaved(t("booking_import_success"));
    else setError(t("booking_import_accept_failed", { error: result.error }));
  };

  const byDay = useMemo(() => {
    const groups = new Map<string, DraftProposal[]>();
    for (const p of generated?.proposals ?? []) groups.set(p.date, [...(groups.get(p.date) ?? []), p]);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [generated]);

  return (
    <div className="space-y-5">
      {!generated && (
        <>
          <fieldset>
            <legend className="text-xs font-black uppercase tracking-widest text-[var(--color-text-muted)]">{t("booking_import_density_label")}</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {DENSITIES.map((value) => (
                <label
                  key={value}
                  className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-xs font-bold transition-colors ${
                    density === value
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  <input type="radio" name={`${baseId}-density`} value={value} checked={density === value} onChange={() => setDensity(value)} className="sr-only" />
                  {t(`booking_import_density_${value}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${baseId}-wishes`} className="text-xs font-black uppercase tracking-widest text-[var(--color-text-muted)]">
              {t("booking_import_wishes_label")}
            </label>
            <textarea
              id={`${baseId}-wishes`}
              value={wishes}
              maxLength={2000}
              onChange={(e) => setWishes(e.target.value)}
              placeholder={t("booking_import_wishes_placeholder")}
              className="mt-2 h-24 w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent-ai)] px-4 text-sm font-black text-white disabled:opacity-60"
          >
            {busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
            {busy ? t("booking_import_generating") : t("booking_import_generate")}
          </button>
        </>
      )}

      {infeasible && (
        <div role="alert" className="rounded-2xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 text-sm">
          <p className="font-black text-[var(--color-text)]">{t("booking_import_infeasible_title")}</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">{t("booking_import_infeasible_body")}</p>
          <p className="mt-2 text-xs font-bold">{t("booking_import_blocked_days", { days: infeasible.blockedDays.join(", ") })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--color-text-secondary)]">
            {infeasible.alternatives.map((a) => <li key={a}>{t(`booking_import_alternative_${a}`)}</li>)}
          </ul>
        </div>
      )}

      {generated && (
        <div className="space-y-4">
          <div>
            <h4 className="text-base font-black text-[var(--color-text)]">{t("booking_import_proposals_title")}</h4>
            <p className="text-xs text-[var(--color-text-secondary)]">{t("booking_import_proposals_intro")}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t("booking_import_verify_general")}</p>
          </div>

          {generated.skippedDays.length > 0 && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {t("booking_import_blocked_days", { days: generated.skippedDays.join(", ") })} · {t("booking_import_alternative_skip_blocked_days")}
            </p>
          )}

          {byDay.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">{t("booking_import_no_proposals")}</p>}

          {byDay.map(([date, proposals]) => (
            <section key={date} aria-label={date} data-testid={`proposals-${date}`} className="space-y-2">
              <h5 className="text-xs font-black uppercase tracking-widest text-[var(--color-text-muted)]">{date}</h5>
              <ul className="space-y-2">
                {proposals.map((p) => {
                  const conflict = p.accepted && editConflicts.has(p.key);
                  return (
                    <li key={p.key} className={`rounded-xl border p-3 ${p.accepted ? "border-dashed border-[var(--color-accent-ai)]/50" : "border-[var(--color-border)] opacity-70"}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="checkbox"
                          checked={p.accepted}
                          onChange={(e) => updateProposal(p.key, { accepted: e.target.checked })}
                          aria-label={t("booking_import_accept_proposal", { title: p.title })}
                          className="size-4 accent-[var(--color-accent-ai)]"
                        />
                        <input
                          value={p.title}
                          onChange={(e) => updateProposal(p.key, { title: e.target.value })}
                          aria-label={t("booking_import_proposal_title_label")}
                          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-bold focus:border-[var(--color-border)]"
                        />
                        <input
                          type="time"
                          value={p.time}
                          onChange={(e) => updateProposal(p.key, { time: e.target.value })}
                          aria-label={t("booking_import_proposal_time_label", { title: p.title })}
                          className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => discardProposal(p.key)}
                          className="min-h-[32px] rounded-lg px-2 text-xs font-bold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
                        >
                          {t("booking_import_discard")}
                        </button>
                      </div>
                      {p.location && <p className="mt-1 pl-6 text-xs text-[var(--color-text-secondary)]">{p.location}</p>}
                      {p.notes && <p className="mt-1 pl-6 text-xs text-[var(--color-text-muted)]">{t("booking_import_to_verify", { notes: p.notes })}</p>}
                      {conflict && <p className="mt-1 pl-6 text-xs font-bold text-[var(--color-danger)]">{t("booking_import_proposal_conflict_edit")}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {(generated.rejected.length > 0 || generated.importerConflicts.length > 0) && (
            <section aria-labelledby={`${baseId}-rejected`} data-testid="rejected-proposals" className="rounded-2xl bg-[var(--color-surface-subtle)] p-4">
              <h5 id={`${baseId}-rejected`} className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[var(--color-text-muted)]">
                <TriangleAlert size={14} aria-hidden="true" />
                {t("booking_import_rejected_title")}
              </h5>
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">
                {generated.rejected.map(({ proposal, reason }, index) => (
                  <li key={`${proposal.date}-${proposal.time}-${index}`}>
                    <span className="font-bold text-[var(--color-text)]">{proposal.title}</span> ({proposal.date} {proposal.time}) — {t(`booking_import_conflict_${reason}`)}
                  </li>
                ))}
                {generated.importerConflicts.map((c, index) => (
                  <li key={`importer-${index}`}>
                    <span className="font-bold text-[var(--color-text)]">{c.date}</span> — {c.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={accept}
              disabled={saving || accepted.length === 0 || editConflicts.size > 0}
              className="min-h-[44px] flex-1 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-black text-white disabled:opacity-50"
            >
              {t("booking_import_accept", { count: accepted.length })}
            </button>
            <button
              type="button"
              onClick={() => setGenerated(null)}
              className="min-h-[44px] rounded-xl px-4 text-sm font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
            >
              {t("booking_import_regenerate")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-[var(--color-danger)]/10 px-3 py-2 text-xs font-bold text-[var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}
