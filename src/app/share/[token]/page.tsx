"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, Loader2, CheckCircle2, AlertCircle, Calendar, Clock } from "lucide-react";
import { useAuthStore } from "@/store/use-auth-store";
import { useItineraryStore } from "@/store/use-itinerary-store";
import { AuthModal } from "@/components/AuthModal";
import { useI18n } from "@/components/I18nProvider";

type ShareInfo = {
  tripId: string;
  tripName: string;
  startDate?: string;
  endDate?: string;
  role: "viewer" | "editor";
  email: string | null;
  accepted: boolean;
};

type TripData = {
  trip: { id: string; name: string; startDate?: string; endDate?: string };
  role: "viewer" | "editor";
  days: Array<{ id: string; date: string; city: string; label: string }>;
  activities: Array<{ id: string; day_id: string; title: string; time: string; duration_min?: number; location?: string; category?: string }>;
  reservations: Array<{ id: string; title: string; reservation_date?: string; booking_deadline?: string; status?: string }>;
};

export default function SharePage() {
  const { t } = useI18n();
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params?.token;
  const { user } = useAuthStore();
  const { switchTrip } = useItineraryStore();

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [tripData, setTripData] = useState<TripData | null>(null);
  const [loading, setLoading] = useState(true);
  // Server-provided messages are shown verbatim; local fallbacks are i18n keys translated at render time.
  const [error, setError] = useState<{ text: string } | { key: string } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [infoRes, tripRes] = await Promise.all([
          fetch(`/api/share/${token}`),
          fetch(`/api/share/${token}/trip`),
        ]);
        const infoData = await infoRes.json();
        const tripDataRes = tripRes.ok ? await tripRes.json() : null;
        if (cancelled) return;
        if (!infoRes.ok) {
          setError(infoData.error ? { text: infoData.error } : { key: "share_page_invalid_link" });
        } else {
          setInfo(infoData as ShareInfo);
          if (tripDataRes) setTripData(tripDataRes as TripData);
        }
      } catch {
        if (!cancelled) setError({ key: "share_error_connection" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    if (!user) {
      setShowAuth(true);
      return;
    }
    setAccepting(true);
    try {
      const { data: { session } } = await (await import("@/lib/supabase")).supabase.auth.getSession();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`/api/share/${token}/accept`, { method: "POST", headers });
      const data = await res.json();
      if (res.ok) {
        if (data.tripId) await switchTrip(data.tripId);
        router.push("/trips");
      } else {
        setError(data.error ? { text: data.error } : { key: "share_page_accept_failed" });
      }
    } catch {
      setError({ key: "share_error_connection" });
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="size-10 border-4 border-[var(--color-primary)]/20 border-t-[var(--color-primary)] rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <AlertCircle className="mx-auto text-[var(--color-danger)]" size={40} />
          <p className="text-sm font-bold text-[var(--color-text-secondary)]">{error ? ("key" in error ? t(error.key) : error.text) : t("share_page_invalid_link")}</p>
        </div>
      </div>
    );
  }

  const activitiesByDay = new Map<string, TripData["activities"]>();
  if (tripData) {
    for (const a of tripData.activities) {
      const list = activitiesByDay.get(a.day_id) ?? [];
      list.push(a);
      activitiesByDay.set(a.day_id, list);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-bg)] p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--color-surface)] backdrop-blur-xl border-2 border-[var(--color-primary)]/10 rounded-[2.5rem] p-6 md:p-8 space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="size-12 bg-[var(--color-primary-subtle)] rounded-2xl flex items-center justify-center">
              <Sparkles className="text-[var(--color-primary)]" size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-black text-[var(--color-text)] truncate">{info.tripName}</h1>
              <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                {info.role === "editor" ? t("share_role_editor") : t("share_role_viewer")} · {info.startDate ?? ""}{info.endDate ? ` → ${info.endDate}` : ""}
              </p>
            </div>
          </div>

          {info.accepted && (
            <div className="flex items-center gap-2 text-[var(--color-primary)] text-sm font-bold">
              <CheckCircle2 size={16} /> {t("share_page_already_accepted")}
            </div>
          )}

          <button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full bg-[var(--color-primary)] text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60 min-h-[48px]"
          >
            {accepting ? <Loader2 className="animate-spin" size={18} /> : (
              <>
                {user ? t("share_page_accept_and_open") : t("share_page_sign_in_to_accept")}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </motion.div>

        {/* Read-only itinerary */}
        {tripData && tripData.days.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-4"
          >
            {tripData.days.map((day) => {
              const acts = activitiesByDay.get(day.id) ?? [];
              return (
                <div key={day.id} className="bg-[var(--color-surface)] backdrop-blur-xl border border-[var(--color-border)] rounded-3xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-[var(--color-primary)]" />
                    <h2 className="text-sm font-black text-[var(--color-text)]">
                      {day.date} {day.city ? `· ${day.city}` : ""}
                    </h2>
                    {day.label && <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">{day.label}</span>}
                  </div>
                  {acts.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)] italic">{t("share_page_no_activities")}</p>
                  ) : (
                    <ul className="space-y-2">
                      {acts.map((a) => (
                        <li key={a.id} className="flex items-start gap-3 bg-[var(--color-surface-subtle)] rounded-2xl px-4 py-3">
                          <Clock size={12} className="mt-0.5 text-[var(--color-text-muted)] shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-[var(--color-text)] truncate">{a.title}</p>
                            <p className="text-[10px] font-medium text-[var(--color-text-muted)]">
                              {a.time}{a.duration_min ? ` · ${t("share_page_duration_min", { minutes: a.duration_min })}` : ""}{a.location ? ` · ${a.location}` : ""}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </div>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} onShowToast={() => {}} />
    </main>
  );
}