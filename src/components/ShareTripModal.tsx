"use client";

/**
 * ShareTripModal
 *
 * Allows the trip owner to:
 *  - Share the trip with a user by email
 *  - View users who currently have access
 *  - Revoke individual access
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Mail,
  Share2,
  Users,
  Trash2,
  Loader2,
  CheckCircle2,
  UserX,
  AlertCircle,
} from "lucide-react";
import type { TripShareUser } from "@/lib/types";
import { supabase } from "@/lib/supabase";

type ShareStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

interface ShareTripModalProps {
  tripId: string;
  tripName: string;
  onClose: () => void;
}

export function ShareTripModal({ tripId, tripName, onClose }: ShareTripModalProps) {
  const [email, setEmail] = useState("");
  const [shareStatus, setShareStatus] = useState<ShareStatus>({ type: "idle" });
  const [shares, setShares] = useState<TripShareUser[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Load current shares on mount
  useEffect(() => {
    void fetchShares();
  }, [tripId]);

  const fetchShares = async () => {
    setSharesLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;

      const res = await fetch(`/api/trips/${tripId}/shares`, { headers });
      if (res.ok) {
        const data = await res.json();
        setShares(data.shares ?? []);
      }
    } catch {
      // non-fatal
    } finally {
      setSharesLoading(false);
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setShareStatus({ type: "error", message: "Ingresa un email válido" });
      return;
    }

    setShareStatus({ type: "loading" });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(`/api/trips/${tripId}/share`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = await res.json();

      if (res.ok) {
        setShareStatus({
          type: "success",
          message: `Viaje compartido con ${trimmedEmail}. Se le enviará una notificación por email.`,
        });
        setEmail("");
        void fetchShares();
      } else {
        setShareStatus({ type: "error", message: data.error ?? "Error al compartir" });
      }
    } catch {
      setShareStatus({ type: "error", message: "Error de conexión. Intenta de nuevo." });
    }
  };

  const handleRevoke = async (userId: string, userEmail: string) => {
    if (!confirm(`¿Revocar acceso de ${userEmail}?`)) return;

    setRevokingId(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;

      const res = await fetch(`/api/trips/${tripId}/shares/${userId}`, {
        method: "DELETE",
        headers,
      });

      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.userId !== userId));
      }
    } catch {
      // non-fatal
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-xl"
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 240 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white dark:bg-slate-950 rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[85dvh] overflow-hidden border border-indigo-500/10"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden">
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
              <Share2 size={18} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white tracking-tight">Compartir viaje</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[200px]">{tripName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Share form */}
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-1.5">
              <Mail size={11} /> Invitar por email
            </label>
            <form onSubmit={handleShare} className="flex gap-2">
              <input
                id="share-trip-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (shareStatus.type !== "idle") setShareStatus({ type: "idle" });
                }}
                placeholder="amigo@email.com"
                className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600"
                disabled={shareStatus.type === "loading"}
              />
              <button
                type="submit"
                disabled={shareStatus.type === "loading" || !email.trim()}
                className="px-5 py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {shareStatus.type === "loading" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Share2 size={14} />
                )}
                <span className="hidden sm:inline">Compartir</span>
              </button>
            </form>

            {/* Status feedback */}
            <AnimatePresence mode="wait">
              {shareStatus.type === "success" && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-2xl px-4 py-3 border border-emerald-200 dark:border-emerald-800"
                >
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                  <p className="text-xs font-medium leading-snug">{shareStatus.message}</p>
                </motion.div>
              )}
              {shareStatus.type === "error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 rounded-2xl px-4 py-3 border border-rose-200 dark:border-rose-800"
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <p className="text-xs font-medium leading-snug">{shareStatus.message}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Current shares list */}
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-1.5">
              <Users size={11} /> Personas con acceso
            </label>

            {sharesLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 size={20} className="text-indigo-500 animate-spin" />
              </div>
            ) : shares.length === 0 ? (
              <div className="py-6 text-center rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-800">
                <UserX size={24} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Nadie tiene acceso aún
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence>
                  {shares.map((share) => (
                    <motion.div
                      key={share.userId}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95, x: -20 }}
                      className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-800"
                    >
                      {/* Avatar */}
                      <div className="size-8 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase">
                          {share.email[0]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{share.email}</p>
                        <p className="text-[10px] font-medium text-slate-400">
                          Desde {new Date(share.createdAt).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRevoke(share.userId, share.email)}
                        disabled={revokingId === share.userId}
                        className="size-8 flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all disabled:opacity-50"
                        aria-label={`Revocar acceso de ${share.email}`}
                        title="Revocar acceso"
                      >
                        {revokingId === share.userId ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* Footer note */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <p className="text-[10px] font-medium text-slate-400 text-center leading-relaxed">
            Los usuarios invitados pueden <span className="font-bold text-slate-500">visualizar</span> el viaje pero no pueden editarlo ni eliminarlo.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
