// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";

const nav = vi.hoisted(() => ({
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  permanentRedirect: nav.permanentRedirect,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
    },
  },
}));

const privacidad = await import("@/app/privacidad/page");
const privacy = await import("@/app/privacy/page");
const { default: Home } = await import("@/app/page");
const { AuthModal } = await import("@/components/AuthModal");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

afterEach(() => cleanup());

function renderPolicy() {
  const Page = privacidad.default;
  return render(<Page />);
}

describe("privacy policy page", () => {
  it("names the responsible party and the public contact as a mailto link", () => {
    renderPolicy();
    const es = screen.getByRole("region", { name: "Política de privacidad" });
    expect(within(es).getAllByText(/Hernán/).length).toBeGreaterThan(0);
    expect(within(es).getAllByText(/España/).length).toBeGreaterThan(0);
    const mail = within(es).getAllByRole("link", { name: "privacidad@tachao.app" });
    expect(mail.length).toBeGreaterThan(0);
    for (const link of mail) expect(link.getAttribute("href")).toBe("mailto:privacidad@tachao.app");
  });

  it("links to the Spanish data protection authority and shows the last update", () => {
    renderPolicy();
    const aepd = screen.getAllByRole("link", { name: /aepd\.es/ });
    expect(aepd.length).toBe(2);
    for (const link of aepd) expect(link.getAttribute("href")).toBe("https://www.aepd.es");
    expect(screen.getByText(/Última actualización: 6 de noviembre de 2026/)).toBeTruthy();
    expect(screen.getByText(/Last updated: 6 November 2026/)).toBeTruthy();
  });

  it("has the full policy in Spanish and in English, reachable from the top", () => {
    renderPolicy();
    const es = screen.getByRole("region", { name: "Política de privacidad" });
    const en = screen.getByRole("region", { name: "Privacy policy" });
    expect(es.getAttribute("lang")).toBe("es");
    expect(en.getAttribute("lang")).toBe("en");
    expect(within(es).getByRole("heading", { name: /Tus derechos/ })).toBeTruthy();
    expect(within(en).getByRole("heading", { name: /Your rights/ })).toBeTruthy();
    expect(within(en).getAllByRole("link", { name: "privacidad@tachao.app" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "English" }).getAttribute("href")).toBe("#en");
    expect(screen.getByRole("link", { name: "Español" }).getAttribute("href")).toBe("#es");
  });

  it("never publishes the personal gmail address", () => {
    const { container } = renderPolicy();
    expect(container.innerHTML).not.toMatch(/gmail/i);
  });

  it("sets the page title", () => {
    expect(String(privacidad.metadata.title)).toMatch(/Privacidad/);
  });

  it("/privacy sends people to the same page", () => {
    const Page = privacy.default;
    expect(() => Page()).toThrow("NEXT_REDIRECT /privacidad");
    expect(nav.permanentRedirect).toHaveBeenCalledWith("/privacidad");
  });
});

describe("links to the privacy policy", () => {
  it("the landing page has one", async () => {
    mockMatchMedia();
    useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, loading: false, hasFetched: true } as never);
    useAuthStore.setState({ user: { id: "anon", is_anonymous: true } } as never);
    renderWithI18n(<Home />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: "Privacidad" }).getAttribute("href")).toBe("/privacidad");
  });

  it("the sign-in sheet has one, in both languages", () => {
    renderWithI18n(<AuthModal isOpen onClose={() => {}} onShowToast={() => {}} />);
    expect(screen.getByRole("link", { name: "Privacidad" }).getAttribute("href")).toBe("/privacidad");
    cleanup();
    renderWithI18n(<AuthModal isOpen onClose={() => {}} onShowToast={() => {}} />, "en");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacidad");
  });
});
