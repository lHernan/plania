"use client";

import { useEffect, useState } from "react";
import { X, MessageCircle, Send, Loader2, Trash2 } from "lucide-react";
import { useAuthStore } from "@/store/use-auth-store";
import { useI18n } from "@/components/I18nProvider";
import type { ActivityComment } from "@/lib/types";

export function ActivityCommentsModal({
  tripId,
  activityId,
  activityTitle,
  onClose,
}: {
  tripId: string;
  activityId: string;
  activityTitle: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Wait for the auth session to be available (it may load after mount).
      let session: { access_token: string } | null = null;
      for (let i = 0; i < 20 && !cancelled; i++) {
        session = (await import("@/store/use-auth-store")).useAuthStore.getState().session;
        if (session?.access_token) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled) return;
      try {
        const headers: HeadersInit = {};
        if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
        const res = await fetch(`/api/trips/${tripId}/comments?activityId=${activityId}`, { headers });
        const data = await res.json();
        console.log("[comments] GET", res.status, data);
        if (!cancelled && res.ok) setComments(data.comments ?? []);
        else if (!cancelled) console.error("[comments] GET failed", data);
      } catch (e) {
        console.error("[comments] GET error", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tripId, activityId]);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const session = (await import("@/store/use-auth-store")).useAuthStore.getState().session;
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/trips/${tripId}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ activityId, content: text.trim() }),
      });
      const data = await res.json();
      console.log("[comments] POST", res.status, data);
      if (res.ok && data.comment) {
        setComments((prev) => [...prev, data.comment]);
        setText("");
      }
    } catch {
      // non-fatal
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      const session = (await import("@/store/use-auth-store")).useAuthStore.getState().session;
      const headers: HeadersInit = {};
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/trips/${tripId}/comments/${commentId}`, { method: "DELETE", headers });
      if (res.ok) setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // non-fatal
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center p-4 bg-[var(--color-text)]/60 backdrop-blur-md" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--color-surface)] rounded-[2rem] shadow-2xl max-h-[80dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} className="text-[var(--color-primary)]" />
            <h2 className="text-sm font-black text-[var(--color-text)] truncate max-w-[220px]">{activityTitle}</h2>
          </div>
          <button onClick={onClose} className="size-8 rounded-full bg-[var(--color-surface-subtle)] flex items-center justify-center text-[var(--color-text-muted)]">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 size={20} className="text-[var(--color-primary)] animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-6">Sin comentarios aún</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="bg-[var(--color-surface-subtle)] rounded-2xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-[var(--color-primary)] truncate">{c.userEmail || "Usuario"}</p>
                  {user && user.id === c.userId && (
                    <button onClick={() => handleDelete(c.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text)]">{c.content}</p>
                <p className="text-[9px] text-[var(--color-text-muted)]">{new Date(c.createdAt).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>

        {user && !user.is_anonymous && (
          <div className="px-5 py-4 border-t border-[var(--color-border)] flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              placeholder="Escribe un comentario..."
              className="flex-1 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-2xl px-4 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 min-h-[40px]"
            />
            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-2xl text-xs font-black uppercase tracking-widest disabled:opacity-50 min-h-[40px] flex items-center gap-1"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
