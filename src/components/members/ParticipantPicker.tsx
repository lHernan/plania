"use client";

import { Check, Users } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemberAvatar } from "@/components/members/MemberAvatar";
import { memberShortName } from "@/lib/trip-people";
import type { TripMember } from "@/lib/types";

const chip =
  "min-h-11 inline-flex items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40";
const on = "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary)]";
const off = "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/40";

/**
 * Who an activity is for. "Everyone" (no ids) is the default; picking people makes it theirs
 * only, and removing the last one makes it shared again.
 */
export function ParticipantPicker({
  members,
  value,
  onChange,
  currentUserId,
  disabled = false,
}: {
  members: TripMember[];
  value: string[];
  onChange: (userIds: string[]) => void;
  currentUserId: string | null;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const everyone = value.length === 0;
  const toggle = (userId: string) => onChange(value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId]);
  // Former members stay listed while still assigned, so the assignment can be undone.
  const formerIds = value.filter((id) => !members.some((member) => member.userId === id));

  return (
    <div role="group" aria-label={t("participants_label")} className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={everyone} disabled={disabled} onClick={() => onChange([])} className={`${chip} ${everyone ? on : off}`}>
        <span className="size-7 inline-flex items-center justify-center rounded-full bg-[var(--color-surface-subtle)]">
          <Users size={14} aria-hidden="true" />
        </span>
        {t("participants_everyone")}
      </button>
      {members.map((member) => {
        const selected = value.includes(member.userId);
        return (
          <button
            key={member.userId}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(member.userId)}
            className={`${chip} ${selected ? on : off}`}
          >
            <MemberAvatar member={member} />
            {member.userId === currentUserId ? t("participants_me") : memberShortName(member)}
            {selected && <Check size={14} aria-hidden="true" />}
          </button>
        );
      })}
      {formerIds.map((userId) => (
        <button key={userId} type="button" aria-pressed disabled={disabled} onClick={() => toggle(userId)} className={`${chip} ${on}`}>
          <MemberAvatar member={undefined} />
          {t("participants_former")}
          <Check size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
