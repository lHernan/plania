"use client";

import { CheckCircle2, Map as MapIcon } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { TachiAvatar } from "@/components/TachiAvatar";
import { ImageSlot, LANDING_IMAGES } from "@/components/landing/ImageSlot";

/** The three things Tachao does, each with its replaceable screenshot slot. */
export function ValueBlocks() {
  const { t } = useI18n();
  const blocks = [
    { key: "plan", image: LANDING_IMAGES.valuePlan, icon: <TachiAvatar size={22} />, title: t("landing_value_plan_title"), body: t("landing_value_plan_body") },
    {
      key: "all",
      image: LANDING_IMAGES.valueAll,
      icon: <MapIcon size={20} aria-hidden="true" className="text-[var(--color-primary)]" />,
      title: t("landing_value_all_title"),
      body: t("landing_value_all_body"),
    },
    {
      key: "live",
      image: LANDING_IMAGES.valueLive,
      icon: <CheckCircle2 size={20} aria-hidden="true" className="text-[var(--color-success)]" />,
      title: t("landing_value_live_title"),
      body: t("landing_value_live_body"),
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {blocks.map((block) => (
        <article key={block.key} className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <ImageSlot src={block.image} alt={block.title} className="h-28" />
          <div className="space-y-1 p-5">
            <div className="flex items-center gap-2">
              {block.icon}
              <h2 className="text-base font-black text-[var(--color-text)]">{block.title}</h2>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">{block.body}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

/** Tachi introduces itself; using it takes an account. */
export function TachiIntro({ onAsk }: { onAsk: () => void }) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col items-start gap-4 rounded-3xl border border-[var(--color-accent-ai)]/30 bg-[var(--color-accent-ai)]/10 p-5 sm:flex-row sm:items-center">
      <TachiAvatar size={48} />
      <div className="flex-1">
        <h2 className="text-lg font-black text-[var(--color-text)]">{t("open_travel_agent")}</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">{t("landing_tachi_body")}</p>
      </div>
      <button
        type="button"
        onClick={onAsk}
        className="min-h-[44px] rounded-2xl bg-[var(--color-accent-ai)] px-5 text-sm font-black text-white"
      >
        {t("open_travel_agent")}
      </button>
    </section>
  );
}
