"use client";

import { useEffect } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useOfflineStore } from "@/store/use-offline-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

export function OfflineStatus() {
  const isOnline = useOfflineStore((s) => s.isOnline);
  const isSyncing = useOfflineStore((s) => s.isSyncing);
  const pendingCount = useOfflineStore((s) => s.pendingCount);
  const setOnline = useOfflineStore((s) => s.setOnline);
  const refreshPendingCount = useOfflineStore((s) => s.refreshPendingCount);
  const syncPendingMutations = useItineraryStore((s) => s.syncPendingMutations);

  useEffect(() => {
    const handleConnectionChange = () => {
      const online = navigator.onLine;
      setOnline(online);

      if (online) {
        void syncPendingMutations();
      }
    };

    void refreshPendingCount();
    window.addEventListener("online", handleConnectionChange);
    window.addEventListener("offline", handleConnectionChange);

    return () => {
      window.removeEventListener("online", handleConnectionChange);
      window.removeEventListener("offline", handleConnectionChange);
    };
  }, [refreshPendingCount, setOnline, syncPendingMutations]);

  if (isOnline && !isSyncing && pendingCount === 0) return null;

  return (
    <div className="sticky top-0 z-[120] border-b border-amber-200 bg-amber-50/95 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-amber-900 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <CloudOff size={14} />}
          <span>{isOnline ? "Syncing changes" : "Offline mode"}</span>
        </div>
        {pendingCount > 0 && <span>{pendingCount} pending sync</span>}
      </div>
    </div>
  );
}
