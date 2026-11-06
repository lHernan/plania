"use client";

import { create } from "zustand";
import { AI_QUOTA_EXCEEDED, isAiQuotaExceeded } from "@/lib/ai/quota-client";
import { supabase } from "@/lib/supabase";
import type { ProposalStatus } from "@/lib/chat/proposals";
import type { ChatMessage } from "@/lib/types";

type ChatStore = {
  isOpen: boolean;
  messages: ChatMessage[];
  /** Status of the proposals received in this session, by assistant message id; history has none. */
  proposals: Record<string, ProposalStatus>;
  loadedTripId: string | null;
  loadingHistory: boolean;
  sending: boolean;
  error: string | null;
  /** Text waiting in the input; Tachi's suggested questions fill it for the user to send. */
  draft: string;
  open: () => void;
  close: () => void;
  loadMessages: (tripId: string) => Promise<void>;
  sendMessage: (tripId: string, content: string, lang?: string) => Promise<void>;
  setDraft: (draft: string) => void;
  setProposalStatus: (messageId: string, status: ProposalStatus) => void;
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
  proposals: {},
  loadedTripId: null,
  loadingHistory: false,
  sending: false,
  error: null,
  draft: "",

  open: () => set({ isOpen: true, error: null }),
  close: () => set({ isOpen: false }),

  loadMessages: async (tripId) => {
    if (get().loadedTripId === tripId || get().loadingHistory) return;
    set({ loadingHistory: true, error: null, messages: [], proposals: {}, loadedTripId: tripId });

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
      // The panel translates this code into the "limit reached" message.
      if (await isAiQuotaExceeded(response)) throw new Error(AI_QUOTA_EXCEEDED);
      const data = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? "Unable to send message");

      const reply = data.message;
      set((state) => ({
        messages: [...state.messages, reply],
        // Only a reply received now can be applied; nothing changes until the user confirms it.
        proposals: reply.actions?.length ? { ...state.proposals, [reply.id]: "pending" } : state.proposals,
        error: null,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to send message" });
    } finally {
      set({ sending: false });
    }
  },

  setDraft: (draft) => set({ draft }),

  setProposalStatus: (messageId, status) => set((state) => ({ proposals: { ...state.proposals, [messageId]: status } })),

  clear: () => set({ messages: [], proposals: {}, loadedTripId: null, error: null }),
}));
