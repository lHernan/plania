// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./helpers/dom";

// S2: "Continuar con Google / Apple" in the sign-in sheet, only for the configured providers.
const oauth = vi.hoisted(() => ({ calls: [] as string[], error: null as string | null }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  },
}));
vi.mock("@/lib/auth/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/oauth")>()),
  startOAuthSignIn: vi.fn(async (provider: string) => {
    oauth.calls.push(provider);
    return { error: oauth.error };
  }),
}));

const { AuthModal } = await import("@/components/AuthModal");
const onShowToast = vi.fn();

function renderModal(lang: "es" | "en" = "es") {
  renderWithI18n(<AuthModal isOpen onClose={() => {}} onShowToast={onShowToast} />, lang);
}

beforeEach(() => {
  oauth.calls = [];
  oauth.error = null;
  onShowToast.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("social sign-in in the sign-in sheet", () => {
  it("offers Google and Apple when both are configured, above the email form", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google,apple");
    renderModal();
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continuar con Apple" })).toBeTruthy();
    expect(screen.getByText("o con tu email")).toBeTruthy();
  });

  it("offers only the configured ones, and none (nor the divider) when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google");
    renderModal();
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continuar con Apple" })).toBeNull();
    cleanup();

    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    renderModal();
    expect(screen.queryByRole("button", { name: /Continuar con/ })).toBeNull();
    expect(screen.queryByText("o con tu email")).toBeNull();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0);
  });

  it("starts the provider's sign-in", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google,apple");
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Apple" }));
    await waitFor(() => expect(oauth.calls).toEqual(["apple"]));
    expect(onShowToast).not.toHaveBeenCalled();
  });

  it("shows the provider's error and lets the user try again", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google");
    oauth.error = "Unsupported provider: provider is not enabled";
    renderModal();
    const google = screen.getByRole("button", { name: "Continuar con Google" }) as HTMLButtonElement;
    fireEvent.click(google);
    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith("Unsupported provider: provider is not enabled"));
    expect(google.disabled).toBe(false);
  });

  it("is in English too", () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google");
    renderModal("en");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByText("or with your email")).toBeTruthy();
  });
});
