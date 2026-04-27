"use client";

import { create } from "zustand";
import { countPendingOfflineMutations } from "@/lib/offline-state";

type OfflineState = {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncError: string | null;
  setOnline: (isOnline: boolean) => void;
  setSyncing: (isSyncing: boolean) => void;
  setLastSyncError: (message: string | null) => void;
  refreshPendingCount: () => Promise<void>;
};

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  isSyncing: false,
  pendingCount: 0,
  lastSyncError: null,
  setOnline: (isOnline) => set({ isOnline }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setLastSyncError: (lastSyncError) => set({ lastSyncError }),
  refreshPendingCount: async () => {
    const pendingCount = await countPendingOfflineMutations();
    set({ pendingCount });
  },
}));
