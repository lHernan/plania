"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { MemoryCard } from "@/components/memories/MemoryCard";
import { MemoryEditor } from "@/components/memories/MemoryEditor";
import { useTripMembers } from "@/components/memories/use-trip-members";
import type { Memory } from "@/lib/types";

type MemoryListProps = {
  tripId: string;
  /** The activity these memories are about; null for memories of the whole trip. */
  activityId: string | null;
  memories: Memory[];
  /** Null when nobody is signed in: memories are shown but cannot be added. */
  currentUserId: string | null;
  /** Accessible name of the list. */
  label: string;
  addLabel: string;
};

/** Memories of an activity (or of the trip) with [Añadir recuerdo]; only authors edit theirs. */
export function MemoryList({ tripId, activityId, memories, currentUserId, label, addLabel }: MemoryListProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ memory?: Memory } | null>(null);
  // Author names come from the member list, needed only when there is something to show.
  const { members } = useTripMembers(tripId, memories.length > 0);

  return (
    <section aria-label={label} className="space-y-2">
      {memories.map((memory) => (
        <MemoryCard key={memory.id} memory={memory} currentUserId={currentUserId} members={members} onEdit={() => setEditing({ memory })} />
      ))}
      {currentUserId && (
        <button
          type="button"
          onClick={() => setEditing({})}
          className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-dashed border-[var(--color-primary)]/40 px-4 text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)] transition-colors"
        >
          <Plus size={16} aria-hidden="true" />
          {addLabel}
        </button>
      )}
      {editing && currentUserId && (
        <MemoryEditor
          key={editing.memory?.id ?? "new"}
          tripId={tripId}
          activityId={editing.memory ? editing.memory.activityId : activityId}
          currentUserId={currentUserId}
          memory={editing.memory}
          onClose={() => setEditing(null)}
        />
      )}
      {memories.length === 0 && !currentUserId && <p className="text-xs text-[var(--color-text-muted)]">{t("memories_none")}</p>}
    </section>
  );
}
