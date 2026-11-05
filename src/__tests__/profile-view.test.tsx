// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/me",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

const { ProfileView } = await import("@/components/ProfileView");
const { useAuthStore } = await import("@/store/use-auth-store");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { TOUR_SEEN_KEY } = await import("@/components/ProductTour");

const signOut = vi.fn(async () => ({ error: null }));

function asUser(user: { email?: string; is_anonymous: boolean } | null) {
  useAuthStore.setState({ initialized: true, user: user ? ({ id: "u", ...user } as never) : null, signOut });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  mockMatchMedia();
  nav.push.mockClear();
  signOut.mockClear();
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false });
  asUser({ email: "me@x.io", is_anonymous: false });
});
afterEach(cleanup);

const sectionTitles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("ProfileView", () => {
  it("shows the account, language, theme and shared trips to a registered user", () => {
    renderWithI18n(<ProfileView />);
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeTruthy();
    expect(sectionTitles()).toEqual(["Cuenta", "Idioma", "Tema"]);
    expect(screen.getByText("me@x.io")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Viajes compartidos conmigo" }).getAttribute("href")).toBe("/trips");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
  });

  it("offers an anonymous visitor to sign in instead of signing out", () => {
    asUser({ is_anonymous: true });
    renderWithI18n(<ProfileView />);
    expect(screen.getByText("Inicia sesión para guardar tus viajes y verlos en cualquier dispositivo.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cerrar sesión" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Viajes compartidos conmigo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(screen.getByRole("heading", { name: /Bienvenido|Crear cuenta|Iniciar sesión/ })).toBeTruthy();
  });

  it("saves the theme under plania_theme and applies it", () => {
    renderWithI18n(<ProfileView />);
    expect(screen.getByRole("radio", { name: "Sistema" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Oscuro" }));
    expect(window.localStorage.getItem("plania_theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("radio", { name: "Oscuro" }).getAttribute("aria-checked")).toBe("true");
  });

  it("switches the language", () => {
    renderWithI18n(<ProfileView />);
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
    expect(window.localStorage.getItem("app_lang")).toBe("en");
  });

  it("signs out", () => {
    renderWithI18n(<ProfileView />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("replays the tour on the current trip", () => {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
    useItineraryStore.setState({ activeTrip: { id: "t-1", name: "Tokio" } as never });
    renderWithI18n(<ProfileView />);
    fireEvent.click(screen.getByRole("button", { name: "Ver el tour de la app" }));
    expect(window.localStorage.getItem(TOUR_SEEN_KEY)).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/trips/t-1");
  });

  it("leaves the tour out without a trip to tour", () => {
    renderWithI18n(<ProfileView />);
    expect(screen.queryByRole("button", { name: "Ver el tour de la app" })).toBeNull();
  });
});
