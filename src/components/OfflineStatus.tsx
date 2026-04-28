"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudOff } from "lucide-react";
import { useOfflineStore } from "@/store/use-offline-store";
import { useItineraryStore } from "@/store/use-itinerary-store";

export function OfflineStatus() {
  const isOnline = useOfflineStore((s) => s.isOnline);
  const setOnline = useOfflineStore((s) => s.setOnline);
  const refreshPendingCount = useOfflineStore((s) => s.refreshPendingCount);
  const syncPendingMutations = useItineraryStore((s) => s.syncPendingMutations);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handleConnectionChange = () => {
      const online = navigator.onLine;
      setOnline(online);

      if (online) {
        void syncPendingMutations();
      }
    };

    handleConnectionChange();
    void refreshPendingCount();
    window.addEventListener("online", handleConnectionChange);
    window.addEventListener("offline", handleConnectionChange);

    return () => {
      window.removeEventListener("online", handleConnectionChange);
      window.removeEventListener("offline", handleConnectionChange);
    };
  }, [refreshPendingCount, setOnline, syncPendingMutations]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowBanner(!isOnline);
    }, isOnline ? 0 : 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOnline]);

  return (
    <AnimatePresence initial={false}>
      {showBanner ? (
        <motion.div
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="sticky top-0 z-[120] border-b border-amber-200 bg-amber-50/95 px-4 pb-2 pt-2 text-[11px] font-bold uppercase tracking-widest text-amber-900 backdrop-blur ios-safe-top"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 ios-compact-shell">
            <CloudOff size={14} />
            <span>You are offline</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
