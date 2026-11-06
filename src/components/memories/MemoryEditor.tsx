"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Sparkles, Star, Trash2, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { requestMemoryCaption } from "@/components/memories/memory-caption-client";
import { MemoryPhotoImage } from "@/components/memories/MemoryPhotoImage";
import { useTripMembers } from "@/components/memories/use-trip-members";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { loadMemoryAudienceChoice, saveMemoryAudienceChoice, type MemoryError } from "@/lib/memories-sync";
import { MEMORY_ERROR_KEYS } from "@/lib/memories-view";
import { MEMORY_PHOTO_ACCEPT } from "@/lib/memory-photos";
import type { Memory, MemoryAudience } from "@/lib/types";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

type MemoryEditorProps = {
  tripId: string;
  /** The activity the memory is about; null for a memory of the whole trip. */
  activityId: string | null;
  currentUserId: string;
  /** The author's memory to edit; omitted to create one. */
  memory?: Memory;
  onClose: () => void;
};

type NewPhoto = { file: File; previewUrl: string | null };

const sameIds = (left: string[], right: string[]) => left.length === right.length && [...left].sort().join() === [...right].sort().join();

const fieldLabel = "text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]";
const chip =
  "min-h-11 inline-flex items-center gap-2 rounded-xl bg-[var(--color-surface-subtle)] px-4 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-subtle)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-60 disabled:pointer-events-none";

/** Sheet to create or edit a memory: note, rating, photos and who sees it. */
export function MemoryEditor({ tripId, activityId, currentUserId, memory, onClose }: MemoryEditorProps) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const noteId = useId();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const store = useItineraryStore;
  // Set once the memory exists: on edit, or after a create whose photos partly failed.
  const [savedId, setSavedId] = useState<string | null>(memory?.id ?? null);
  const saved = useItineraryStore((state) => (savedId ? state.activeTrip?.memories?.find((entry) => entry.id === savedId) : undefined)) ?? memory;

  const [note, setNote] = useState(memory?.note ?? "");
  const [rating, setRating] = useState<number | null>(memory?.rating ?? null);
  const [audience, setAudience] = useState<MemoryAudience>(() => memory?.audience ?? loadMemoryAudienceChoice(tripId));
  const [chosen, setChosen] = useState<string[]>(() => (memory?.audienceUserIds ?? []).filter((id) => id !== currentUserId));
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<NewPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // Suggested caption (AI): registered users only, never for guests.
  const isRegistered = useAuthStore((state) => Boolean(state.user && !state.user.is_anonymous));
  const [suggesting, setSuggesting] = useState(false);
  // Stable references from the store (a new object per read would re-render forever).
  const activityDay = useItineraryStore((state) => (activityId ? state.activeTrip?.days?.find((day) => day.activities.some((entry) => entry.id === activityId)) : undefined));
  const activity = activityDay?.activities.find((entry) => entry.id === activityId);

  const { members, loading: membersLoading, error: membersError } = useTripMembers(tripId, audience === "selected");
  const others = members.filter((member) => member.userId !== currentUserId);
  const keptPhotos = (saved?.photos ?? []).filter((photo) => !removedPhotoIds.includes(photo.id));

  // Previews are object URLs: released when removed (below) and when the sheet closes.
  const previewsRef = useRef<NewPhoto[]>([]);
  useEffect(() => {
    previewsRef.current = newPhotos;
  }, [newPhotos]);
  useEffect(() => {
    noteRef.current?.focus();
    return () => previewsRef.current.forEach((photo) => photo.previewUrl && URL.revokeObjectURL(photo.previewUrl));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmDialog && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDialog, busy, onClose]);

  const addFiles = (files: File[]) => {
    const canPreview = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
    setNewPhotos((current) => [...current, ...files.map((file) => ({ file, previewUrl: canPreview ? URL.createObjectURL(file) : null }))]);
  };
  const removeNewPhoto = (index: number) => {
    const photo = newPhotos[index];
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setNewPhotos((current) => current.filter((_, i) => i !== index));
  };

  const showError = (code: MemoryError | undefined) => setError(t(MEMORY_ERROR_KEYS[code ?? "failed"] ?? "memory_error_failed"));

  /** Keeps only the photos that failed so saving again retries them; true when none failed. */
  const keepFailed = (failed: number[] | undefined) => {
    const failedSet = new Set(failed ?? []);
    if (failedSet.size === 0) return true;
    newPhotos.forEach((photo, index) => !failedSet.has(index) && photo.previewUrl && URL.revokeObjectURL(photo.previewUrl));
    setNewPhotos(newPhotos.filter((_, index) => failedSet.has(index)));
    setError(t("memory_photos_failed", { count: failedSet.size }));
    return false;
  };

  const audienceIds = audience === "selected" ? chosen : [];
  const trimmedNote = note.trim() || null;

  const create = async () => {
    const result = await store.getState().createMemory({
      activityId,
      note: trimmedNote,
      rating,
      audience,
      audienceUserIds: audienceIds,
      photos: newPhotos.map((photo) => photo.file),
    });
    if (result.error || !result.memoryId) return showError(result.error);
    saveMemoryAudienceChoice(tripId, audience);
    setSavedId(result.memoryId);
    if (keepFailed(result.failedPhotos)) onClose();
  };

  const update = async (id: string, base: Memory | undefined) => {
    const actions = store.getState();
    if (trimmedNote !== (base?.note ?? null) || rating !== (base?.rating ?? null)) {
      const { error: patchError } = await actions.updateMemory(id, { note: trimmedNote, rating });
      if (patchError) return showError(patchError);
    }
    for (const photoId of removedPhotoIds) {
      const { error: removeError } = await actions.removeMemoryPhoto(id, photoId);
      if (removeError) return showError(removeError);
    }
    setRemovedPhotoIds([]);
    if (audience !== base?.audience || !sameIds(audienceIds, (base?.audienceUserIds ?? []).filter((user) => user !== currentUserId))) {
      const { error: audienceError } = await actions.setMemoryAudience(id, audience, audienceIds);
      if (audienceError) return showError(audienceError);
    }
    saveMemoryAudienceChoice(tripId, audience);
    if (newPhotos.length > 0) {
      const result = await actions.addMemoryPhotos(id, newPhotos.map((photo) => photo.file));
      if (result.error) return showError(result.error);
      if (!keepFailed(result.failedPhotos)) return;
    }
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!trimmedNote && !rating && keptPhotos.length === 0 && newPhotos.length === 0) {
      setError(t("memory_error_empty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (savedId) await update(savedId, saved);
      else await create();
    } catch {
      showError("failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!savedId || busy) return;
    if (!(await confirm({ message: t("memory_delete_confirm") }))) return;
    setBusy(true);
    const { error: deleteError } = await store.getState().deleteMemory(savedId);
    setBusy(false);
    if (deleteError) showError(deleteError);
    else onClose();
  };

  // Fill rule: the suggestion only fills an empty note, so it never overwrites what the user wrote.
  const suggestCaption = async () => {
    if (suggesting || note.trim()) return;
    setSuggesting(true);
    setError(null);
    const result = await requestMemoryCaption({
      tripId,
      activityTitle: activity?.title,
      city: activity?.city || activityDay?.city,
      lang,
    });
    setSuggesting(false);
    if ("caption" in result) setNote((current) => (current.trim() ? current : result.caption));
    else if (result.error === "quota_exceeded") setError(t("ai_quota_exceeded"));
    else setError(t(result.error === "offline" ? "memory_caption_offline" : "memory_caption_error"));
  };

  const toggleChosen = (userId: string) =>
    setChosen((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));

  const photoCount = keptPhotos.length + newPhotos.length;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center md:items-center md:p-4">
      <div className="absolute inset-0 bg-[var(--color-text)]/40 backdrop-blur-sm" aria-hidden="true" onClick={() => !busy && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-[var(--color-surface)] shadow-xl md:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <h2 id={titleId} className="text-base font-black text-[var(--color-text)]">
            {t(memory ? "memory_editor_title_edit" : "memory_editor_title_new")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("memory_editor_close")}
            className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 space-y-5 overflow-y-auto px-5 py-4" aria-busy={busy}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={noteId} className={fieldLabel}>{t("memory_note_label")}</label>
              {isRegistered && (
                <button
                  type="button"
                  onClick={() => void suggestCaption()}
                  disabled={busy || suggesting || Boolean(note.trim())}
                  title={note.trim() ? t("memory_caption_note_filled") : undefined}
                  className={chip}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  {suggesting ? t("memory_caption_suggesting") : t("memory_caption_suggest")}
                </button>
              )}
            </div>
            <textarea
              id={noteId}
              ref={noteRef}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={4000}
              rows={4}
              placeholder={t("memory_note_placeholder")}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>

          <div className="space-y-2">
            <span id={`${titleId}-rating`} className={fieldLabel}>{t("memory_rating_label")}</span>
            <div className="flex flex-wrap items-center gap-1">
              <div role="radiogroup" aria-labelledby={`${titleId}-rating`} className="flex">
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-xl text-[var(--color-warning)] hover:bg-[var(--color-surface-subtle)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)]">
                    <input
                      type="radio"
                      name={`${titleId}-rating`}
                      value={value}
                      checked={rating === value}
                      onChange={() => setRating(value)}
                      aria-label={t("memory_rating_value", { count: value })}
                      className="sr-only"
                    />
                    <Star size={22} aria-hidden="true" fill={rating !== null && value <= rating ? "currentColor" : "none"} />
                  </label>
                ))}
              </div>
              {rating !== null && (
                <button type="button" onClick={() => setRating(null)} className="min-h-11 rounded-xl px-3 text-xs font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]">
                  {t("memory_rating_clear")}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <span className={fieldLabel}>{t("memory_photos_label")}</span>
            {photoCount > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {keptPhotos.map((photo, index) => (
                  <li key={photo.id} className="relative">
                    <MemoryPhotoImage path={photo.path} alt={t("memory_photo_alt", { number: index + 1 })} placeholderLabel={t("memory_photo_unavailable")} className="aspect-square" />
                    <RemovePhotoButton label={t("memory_photo_remove", { number: index + 1 })} disabled={busy} onClick={() => setRemovedPhotoIds((ids) => [...ids, photo.id])} />
                  </li>
                ))}
                {newPhotos.map((photo, index) => {
                  const number = keptPhotos.length + index + 1;
                  return (
                    <li key={`${photo.file.name}-${index}`} className="relative">
                      <div className="relative aspect-square overflow-hidden rounded-xl bg-[var(--color-surface-subtle)]">
                        {photo.previewUrl && (
                          // eslint-disable-next-line @next/next/no-img-element -- local preview of a picked file
                          <img src={photo.previewUrl} alt={t("memory_photo_alt", { number })} className="absolute inset-0 h-full w-full object-cover" />
                        )}
                      </div>
                      <RemovePhotoButton label={t("memory_photo_remove", { number })} disabled={busy} onClick={() => removeNewPhoto(index)} />
                    </li>
                  );
                })}
              </ul>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={MEMORY_PHOTO_ACCEPT}
              aria-label={t("memory_photos_add")}
              tabIndex={-1}
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                // Cleared so picking the same file again still fires a change.
                event.target.value = "";
                if (files.length > 0) addFiles(files);
              }}
            />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={chip}>
              <ImagePlus size={16} aria-hidden="true" />
              {t("memory_photos_add")}
            </button>
          </div>

          <div className="space-y-2">
            <span id={`${titleId}-audience`} className={fieldLabel}>{t("memory_audience_label")}</span>
            <div role="radiogroup" aria-labelledby={`${titleId}-audience`} className="space-y-1">
              {(["trip", "selected"] as const).map((value) => (
                <label key={value} className="min-h-11 flex cursor-pointer items-center gap-3 rounded-xl px-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]">
                  <input
                    type="radio"
                    name={`${titleId}-audience`}
                    value={value}
                    checked={audience === value}
                    onChange={() => setAudience(value)}
                    className="size-5 accent-[var(--color-primary)]"
                  />
                  {t(value === "trip" ? "memory_audience_trip" : "memory_audience_selected")}
                </label>
              ))}
            </div>
            {audience === "selected" && (
              <div role="group" aria-label={t("memory_audience_people")} className="space-y-1 rounded-xl border border-[var(--color-border)] p-2">
                <label className="min-h-11 flex items-center gap-3 px-2 text-sm text-[var(--color-text-secondary)]">
                  <input type="checkbox" checked disabled className="size-5 accent-[var(--color-primary)]" aria-label={t("memory_audience_me")} />
                  <span aria-hidden="true">{t("memory_audience_me")}</span>
                </label>
                {others.map((member) => (
                  <label key={member.userId} className="min-h-11 flex cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]">
                    <input
                      type="checkbox"
                      checked={chosen.includes(member.userId)}
                      onChange={() => toggleChosen(member.userId)}
                      className="size-5 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 truncate">{member.email ?? t("memory_author_unknown")}</span>
                    {member.isOwner && <span className="ml-auto shrink-0 text-xs text-[var(--color-text-muted)]">{t("memory_audience_owner")}</span>}
                  </label>
                ))}
                {membersLoading && <p className="px-2 text-xs text-[var(--color-text-muted)]">{t("memory_members_loading")}</p>}
                {membersError && <p className="px-2 text-xs text-[var(--color-text-muted)]">{t(MEMORY_ERROR_KEYS[membersError])}</p>}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pb-[env(safe-area-inset-bottom,0px)]">
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? t("memory_saving") : t("memory_save")}
            </button>
            {savedId && (
              <button type="button" disabled={busy} onClick={() => void remove()} className={`${chip} text-[var(--color-danger)]`}>
                <Trash2 size={16} aria-hidden="true" />
                {t("memory_delete")}
              </button>
            )}
          </div>
        </form>
      </div>
      {confirmDialog}
    </div>,
    document.body,
  );
}

function RemovePhotoButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-xl text-white"
    >
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-black/60">
        <X size={14} aria-hidden="true" />
      </span>
    </button>
  );
}
