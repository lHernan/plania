"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, FilePlus2, RotateCcw } from "lucide-react";
import { AuthModal } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";
import { TachiAvatar } from "@/components/TachiAvatar";
import { WhereWhenFields } from "@/components/planner/WhereWhenFields";
import { authHeaders } from "@/lib/auth-headers";
import { buildPlanningContext, type DayDensity, type Proposal } from "@/lib/bookings/plan";
import {
  PLANNER_INTERESTS,
  buildDraftTrip,
  clearPlannerState,
  destinationList,
  formFromQuery,
  loadPlannerState,
  newDraftId,
  plannedDates,
  plannerPreferences,
  plannerWishes,
  savePlannerState,
  withProposals,
  type BudgetLevel,
  type PlannerForm,
  type StoredPlanner,
} from "@/lib/planner/form";
import { requestPlanning } from "@/lib/planner/plan-request";
import { tripPath } from "@/lib/trip-routes";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

const PACES: DayDensity[] = ["light", "balanced", "full"];
const BUDGETS: BudgetLevel[] = ["low", "medium", "high"];
const STEPS = 3;

const chipClass = (selected: boolean) =>
  `flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border px-3 text-center text-xs font-bold transition-colors ${
    selected
      ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
      : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
  }`;
const legendClass = "text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-text-muted)]";

/** The planner's starting point: what the visitor left before signing in, else the landing's query. */
function initialPlanner(params: Pick<URLSearchParams, "get">): StoredPlanner {
  const stored = loadPlannerState();
  const fromLanding = ["dest", "start", "end", "days"].some((key) => params.get(key));
  if (stored && (stored.pendingGenerate || !fromLanding)) return stored;
  return { form: formFromQuery(params), step: 0, pendingGenerate: false };
}

/**
 * /plan: destination and dates (or a number of days), the style, then the trip day by day.
 * Anyone can create a draft from it; generating with Tachi takes an account, and a visitor who
 * signs in for it comes back to the same form, which then generates.
 */
export function Planner() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const baseId = useId();
  const user = useAuthStore((s) => s.user);
  const loadTemplate = useItineraryStore((s) => s.loadTemplate);
  const saveDraft = useItineraryStore((s) => s.saveDraft);
  const isRegistered = Boolean(user && !user.is_anonymous);

  const [initial] = useState(() => initialPlanner(searchParams));
  const [form, setForm] = useState<PlannerForm>(initial.form);
  const [step, setStep] = useState(initial.step);
  const [stepError, setStepError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const pendingGenerate = useRef(initial.pendingGenerate);

  // Kept for this tab, so a sign-in (even with a reload) comes back to the same form.
  useEffect(() => {
    savePlannerState({ form, step, pendingGenerate: pendingGenerate.current });
  }, [form, step]);

  const update = (patch: Partial<PlannerForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setStepError(null);
  };

  const dates = plannedDates(form);
  const destinations = destinationList(form.destinations);

  const buildPlan = () =>
    buildDraftTrip({
      id: newDraftId(),
      name: destinations.join(" · "),
      destinations,
      dates,
      userId: user?.id,
      preferences: plannerPreferences(form),
    });

  const goNext = () => {
    if (step === 0) {
      if (destinations.length === 0) return setStepError(t("planner_destination_required"));
      if (dates.length === 0) return setStepError(t("planner_dates_invalid"));
    }
    setStepError(null);
    setStep((s) => Math.min(STEPS - 1, s + 1));
  };

  const generate = useCallback(async () => {
    if (!isRegistered) {
      pendingGenerate.current = true;
      savePlannerState({ form, step, pendingGenerate: true });
      setAuthOpen(true);
      return;
    }
    const plan = buildDraftTrip({
      id: newDraftId(),
      name: destinationList(form.destinations).join(" · "),
      destinations: destinationList(form.destinations),
      dates: plannedDates(form),
      preferences: plannerPreferences(form),
    });
    if (plan.days.length === 0) return;
    setBusy(true);
    setGenerateFailed(false);
    try {
      const context = buildPlanningContext({
        tripName: plan.name,
        startDate: plan.startDate,
        endDate: plan.endDate,
        days: plan.days,
        density: form.pace,
        ...(form.minimizeWalking ? { preferences: { minimizeWalking: true } } : {}),
      });
      const { valid } = await requestPlanning({ context, request: plannerWishes(form), lang, headers: await authHeaders() });
      setProposals(valid);
      setStep(STEPS - 1);
    } catch {
      setGenerateFailed(true);
    } finally {
      setBusy(false);
    }
  }, [form, isRegistered, lang, step]);

  // Back from the sign-in Tachi asked for: generate with the data already filled in.
  useEffect(() => {
    if (!isRegistered || !pendingGenerate.current) return;
    pendingGenerate.current = false;
    const timer = setTimeout(() => void generate(), 0);
    return () => clearTimeout(timer);
  }, [generate, isRegistered]);

  const closeAuth = () => {
    setAuthOpen(false);
    const stillGuest = useAuthStore.getState().user?.is_anonymous !== false;
    if (stillGuest) {
      pendingGenerate.current = false;
      savePlannerState({ form, step, pendingGenerate: false });
    }
  };

  // Without an account the trip is a draft, like a template: nothing is written until it is saved.
  const createDraft = () => {
    const plan = buildPlan();
    loadTemplate(plan);
    clearPlannerState();
    router.push(tripPath(plan.id));
  };

  // A registered user gets a real trip, through the same save a draft uses.
  const createTrip = async () => {
    const plan = proposals ? withProposals(buildPlan(), proposals) : buildPlan();
    setSaving(true);
    setSaveError(null);
    loadTemplate(plan);
    const result = await saveDraft();
    setSaving(false);
    if (result.error) {
      setSaveError(t("planner_save_failed", { error: result.error }));
      return;
    }
    clearPlannerState();
    const savedId = useItineraryStore.getState().activeTrip?.id ?? plan.id;
    router.push(tripPath(savedId));
  };

  const proposalsFor = (date: string) => (proposals ?? []).filter((p) => p.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const stepTitles = [t("planner_step_where"), t("planner_step_style"), t("planner_step_preview")];

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 py-6 md:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="flex min-h-[44px] items-center text-sm font-black text-[var(--color-primary)]">
            {t("landing_title")}
          </Link>
          <p className="text-xs font-bold text-[var(--color-text-muted)]">{t("planner_step_of", { current: step + 1, total: STEPS })}</p>
        </header>

        <div className="space-y-1">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-[var(--color-primary)]">{t("planner_title")}</p>
          <h1 className="text-2xl font-black text-[var(--color-text)] font-[family-name:var(--font-display)]">{stepTitles[step]}</h1>
        </div>

        <section className="flex-1 space-y-5">
          {step === 0 && <WhereWhenFields value={form} onChange={update} showHint />}

          {step === 1 && (
            <>
              <fieldset>
                <legend className={legendClass}>{t("booking_import_density_label")}</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {PACES.map((pace) => (
                    <label key={pace} className={chipClass(form.pace === pace)}>
                      <input type="radio" name={`${baseId}-pace`} checked={form.pace === pace} onChange={() => update({ pace })} className="sr-only" />
                      {t(`booking_import_density_${pace}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className={legendClass}>{t("planner_budget_label")}</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {BUDGETS.map((budget) => (
                    <label key={budget} className={chipClass(form.budget === budget)}>
                      <input type="radio" name={`${baseId}-budget`} checked={form.budget === budget} onChange={() => update({ budget })} className="sr-only" />
                      {t(`planner_budget_${budget}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={`${chipClass(form.minimizeWalking)} justify-start gap-2`}>
                <input
                  type="checkbox"
                  checked={form.minimizeWalking}
                  onChange={(e) => update({ minimizeWalking: e.target.checked })}
                  className="size-4 accent-[var(--color-primary)]"
                />
                {t("planner_minimize_walking")}
              </label>
              <fieldset>
                <legend className={legendClass}>{t("planner_interests_label")}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PLANNER_INTERESTS.map((interest) => {
                    const selected = form.interests.includes(interest);
                    return (
                      <label key={interest} className={chipClass(selected)}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            update({ interests: selected ? form.interests.filter((i) => i !== interest) : [...form.interests, interest] })
                          }
                          className="sr-only"
                        />
                        {t(`planner_interest_${interest}`)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}

          {step === 2 && (
            <ol data-testid="planner-preview" className="space-y-3">
              {dates.map((date, index) => {
                const dayProposals = proposalsFor(date);
                return (
                  <li key={date} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-sm font-black text-[var(--color-text)]">{t("planner_day_label", { n: index + 1 })}</h2>
                      <p className="text-xs font-bold text-[var(--color-text-muted)]">
                        {date}
                        {destinations.length > 0 ? ` · ${destinations[Math.min(destinations.length - 1, Math.floor((index * destinations.length) / dates.length))]}` : ""}
                      </p>
                    </div>
                    {dayProposals.length === 0 ? (
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t("planner_day_empty")}</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {dayProposals.map((p, i) => (
                          <li key={`${p.time}-${i}`} className="flex gap-2 text-sm text-[var(--color-text)]">
                            <span className="font-bold tabular-nums text-[var(--color-text-muted)]">{p.time}</span>
                            <span>{p.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {stepError && <p role="alert" className="text-sm font-bold text-[var(--color-danger)]">{stepError}</p>}

          {generateFailed && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--color-danger)]/10 p-4">
              <TachiAvatar state="error" size={28} />
              <p className="flex-1 text-sm font-bold text-[var(--color-danger)]">{t("planner_generate_failed")}</p>
              <button
                type="button"
                onClick={() => void generate()}
                className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--color-danger)]/40 px-4 text-sm font-black text-[var(--color-danger)]"
              >
                <RotateCcw size={14} aria-hidden="true" />
                {t("planner_retry")}
              </button>
            </div>
          )}

          {saveError && <p role="alert" className="text-sm font-bold text-[var(--color-danger)]">{saveError}</p>}
        </section>

        <footer className="sticky bottom-0 space-y-3 bg-[var(--color-bg)] pb-4 pt-2">
          {step === 2 && !isRegistered && <p className="text-xs text-[var(--color-text-secondary)]">{t("planner_guest_note")}</p>}
          <div className="flex flex-wrap gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="flex min-h-[48px] items-center gap-2 rounded-2xl border border-[var(--color-border)] px-4 text-sm font-bold text-[var(--color-text-secondary)]"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                {t("planner_back")}
              </button>
            )}
            {step < STEPS - 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-primary)] px-4 text-sm font-black text-white"
              >
                {t("planner_next")}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={busy || saving}
                  className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent-ai)] px-4 text-sm font-black text-white disabled:opacity-60"
                >
                  <TachiAvatar state={busy ? "thinking" : "idle"} size={18} />
                  {busy ? t("planner_generating") : t("planner_generate")}
                </button>
                <button
                  type="button"
                  onClick={isRegistered ? () => void createTrip() : createDraft}
                  disabled={busy || saving}
                  className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-primary)] px-4 text-sm font-black text-white disabled:opacity-60"
                >
                  <FilePlus2 size={16} aria-hidden="true" />
                  {isRegistered ? t("planner_create_trip") : t("planner_create_draft")}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>

      <AuthModal isOpen={authOpen} reason="tachi" onClose={closeAuth} onShowToast={() => {}} />
    </main>
  );
}
