"use client";

import { Users } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { memberShortName, type ItineraryPerson } from "@/lib/trip-people";
import type { TripMember } from "@/lib/types";

const chip =
  "min-h-11 shrink-0 inline-flex items-center gap-1.5 rounded-full border pl-1 pr-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40";
const on = "border-[var(--color-primary)] bg-[var(--color-primary)] text-white";
const off = "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]";

/**
 * Whose itinerary is shown: everyone, mine, or one person's (shared activities plus theirs).
 * A compact row of chips that scrolls sideways on narrow screens.
 */
export function ItineraryPersonFilter({
  members,
  value,
  onChange,
  currentUserId,
}: {
  members: TripMember[];
  value: ItineraryPerson;
  onChange: (person: ItineraryPerson) => void;
  currentUserId: string | null;
}) {
  const { t } = useI18n();
  // "Mine" first, then the others in trip order.
  const me = members.find((member) => member.userId === currentUserId);
  const others = members.filter((member) => member.userId !== currentUserId);

  return (
    <div role="radiogroup" aria-label={t("itinerary_filter_label")} className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
      <button type="button" role="radio" aria-checked={value === "everyone"} onClick={() => onChange("everyone")} className={`${chip} ${value === "everyone" ? on : off} pl-3`}>
        <Users size={14} aria-hidden="true" />
        {t("participants_everyone")}
      </button>
      {me && (
        <button type="button" role="radio" aria-checked={value === me.userId} onClick={() => onChange(me.userId)} className={`${chip} ${value === me.userId ? on : off}`}>
          <MemberAvatar member={me} size="xs" />
          {t("itinerary_filter_mine")}
        </button>
      )}
      {others.map((member) => (
        <button
          key={member.userId}
          type="button"
          role="radio"
          aria-checked={value === member.userId}
          onClick={() => onChange(member.userId)}
          className={`${chip} ${value === member.userId ? on : off}`}
        >
          <MemberAvatar member={member} size="xs" />
          {memberShortName(member)}
        </button>
      ))}
    </div>
  );
}
