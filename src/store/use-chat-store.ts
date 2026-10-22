"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { ChatMessage } from "@/lib/types";

type ChatStore = {
  isOpen: boolean;
  messages: ChatMessage[];
  loadedTripId: string | null;
  loadingHistory: boolean;
  sending: boolean;
  error: string | null;
  open: () => void;
  close: () => void;
  loadMessages: (tripId: string) => Promise<void>;
  sendMessage: (tripId: string, content: string, lang?: string) => Promise<void>;
  clear: () => void;
};

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  isOpen: false,
  messages: [],
  loadedTripId: null,
  loadingHistory: false,
  sending: false,
  error: null,

  open: () => set({ isOpen: true, error: null }),
  close: () => set({ isOpen: false }),

  loadMessages: async (tripId) => {
    if (get().loadedTripId === tripId || get().loadingHistory) return;
    set({ loadingHistory: true, error: null, messages: [], loadedTripId: tripId });

    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/chat?tripId=${encodeURIComponent(tripId)}`, { headers });
      const data = await response.json() as { messages?: ChatMessage[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load chat history");
      set({ messages: data.messages ?? [], error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load chat history" });
    } finally {
      set({ loadingHistory: false });
    }
  },

  sendMessage: async (tripId, content, lang) => {
    const trimmedContent = content.trim();
    if (!trimmedContent || get().sending) return;

    const optimisticMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      tripId,
      userId: "local",
      role: "user",
      content: trimmedContent,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      messages: [...state.messages, optimisticMessage],
      sending: true,
      error: null,
      loadedTripId: tripId,
    }));

    try {
      const headers = await authHeaders();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ tripId, content: trimmedContent, lang }),
      });
      const data = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? "Unable to send message");

      set((state) => ({
        messages: [...state.messages, data.message!],
        error: null,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to send message" });
    } finally {
      set({ sending: false });
    }
  },

  clear: () => set({ messages: [], loadedTripId: null, error: null }),
}));
