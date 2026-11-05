// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  },
}));

const { AuthModal } = await import("@/components/AuthModal");

afterEach(() => cleanup());

const DRAFT = "Crea una cuenta o inicia sesión para guardar este viaje. No perderás nada.";
const TACHI = "Tachi es para usuarios registrados. Inicia sesión y seguiremos donde lo dejaste.";

function renderModal(reason?: "draft" | "tachi", lang: "es" | "en" = "es") {
  renderWithI18n(<AuthModal isOpen onClose={() => {}} onShowToast={() => {}} reason={reason} />, lang);
}

describe("sign-in sheet says why it is asked for", () => {
  it("saving a draft", () => {
    renderModal("draft");
    expect(screen.getByText("Guarda tu borrador")).toBeTruthy();
    expect(screen.getByText(DRAFT)).toBeTruthy();
  });

  it("asking Tachi", () => {
    renderModal("tachi");
    expect(screen.getByText("Pregúntale a Tachi")).toBeTruthy();
    expect(screen.getByText(TACHI)).toBeTruthy();
  });

  it("in English too", () => {
    renderModal("tachi", "en");
    expect(screen.getByText("Ask Tachi")).toBeTruthy();
  });

  it("without a trigger it keeps the plain sign-in", () => {
    renderModal();
    expect(screen.queryByText("Guarda tu borrador")).toBeNull();
    expect(screen.queryByText(TACHI)).toBeNull();
    expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeTruthy();
  });
});
