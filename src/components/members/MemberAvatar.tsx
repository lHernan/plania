"use client";

import { memberInitials, memberShortName } from "@/lib/trip-people";
import type { TripMember } from "@/lib/types";

const SIZES = { xs: "size-5 text-[9px]", sm: "size-7 text-[10px]", md: "size-9 text-xs" } as const;

/** A member's picture, or their initials on the brand tint when there is none. */
export function MemberAvatar({ member, size = "sm", className = "" }: { member: TripMember | undefined; size?: keyof typeof SIZES; className?: string }) {
  const label = memberShortName(member);
  return member?.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote profile pictures from the auth provider
    <img
      src={member.avatarUrl}
      alt=""
      title={label}
      referrerPolicy="no-referrer"
      className={`${SIZES[size]} shrink-0 rounded-full object-cover ring-2 ring-[var(--color-surface)] ${className}`}
    />
  ) : (
    <span
      title={label}
      aria-hidden="true"
      className={`${SIZES[size]} shrink-0 inline-flex items-center justify-center rounded-full bg-[var(--color-primary-subtle)] font-black text-[var(--color-primary)] ring-2 ring-[var(--color-surface)] ${className}`}
    >
      {memberInitials(member)}
    </span>
  );
}

/** Overlapping avatars of some members (at most `max`, then "+N"). */
export function AvatarStack({ members, max = 3, size = "xs" }: { members: (TripMember | undefined)[]; max?: number; size?: keyof typeof SIZES }) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5" aria-hidden="true">
      {shown.map((member, index) => (
        <MemberAvatar key={member?.userId ?? index} member={member} size={size} />
      ))}
      {rest > 0 && (
        <span className={`${SIZES[size]} inline-flex items-center justify-center rounded-full bg-[var(--color-surface-subtle)] font-bold text-[var(--color-text-secondary)] ring-2 ring-[var(--color-surface)]`}>
          +{rest}
        </span>
      )}
    </span>
  );
}
