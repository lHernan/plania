"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { WhereWhenFields, type WhereWhen } from "@/components/planner/WhereWhenFields";
import { defaultPlannerForm, plannerQuery } from "@/lib/planner/form";

/** The landing's planning field: where and when, then the planner with those values filled in. */
export function PlanField() {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState<WhereWhen>(() => {
    const { destinations, mode, startDate, endDate, dayCount } = defaultPlannerForm();
    return { destinations, mode, startDate, endDate, dayCount };
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = plannerQuery(value);
    router.push(query ? `/plan?${query}` : "/plan");
  };

  return (
    <form
      onSubmit={submit}
      className="w-full space-y-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl md:p-5"
    >
      <WhereWhenFields value={value} onChange={(patch) => setValue((v) => ({ ...v, ...patch }))} />
      <button
        type="submit"
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--color-primary)] px-6 text-sm font-black text-white shadow-lg transition-colors hover:bg-[var(--color-primary-hover)]"
      >
        {t("landing_start_planning")}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
