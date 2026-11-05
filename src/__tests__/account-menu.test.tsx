// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mockMatchMedia, renderWithI18n } from "./helpers/dom";
import { AccountMenu } from "@/components/AccountMenu";

function renderMenu(props: Partial<Parameters<typeof AccountMenu>[0]> = {}) {
  const handlers = { onStartTour: vi.fn(), onSignOut: vi.fn(), onSignIn: vi.fn() };
  renderWithI18n(
    <>
      <AccountMenu email="me@x.io" {...handlers} {...props} />
      <p>outside</p>
    </>,
  );
  return handlers;
}

const trigger = () => screen.getByRole("button", { name: "Menú de la cuenta" });
const open = () => {
  fireEvent.click(trigger());
  return screen.getByRole("menu");
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  mockMatchMedia();
});
afterEach(cleanup);

describe("AccountMenu", () => {
  it("is a 44px avatar button that announces its menu", () => {
    renderMenu();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().className).toContain("size-11");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the email, language, theme, tour and sign out to a signed-in user", () => {
    renderMenu();
    const menu = open();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu.textContent).toContain("me@x.io");
    for (const name of ["Español", "English", "Claro", "Oscuro", "Sistema"]) {
      expect(within(menu).getByRole("menuitemradio", { name })).toBeTruthy();
    }
    expect(within(menu).getByRole("menuitem", { name: "Ver el tour de la app" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Cerrar sesión" })).toBeTruthy();
  });

  it("closes with Escape and gives focus back to the avatar", () => {
    renderMenu();
    open();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside", () => {
    renderMenu();
    open();
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("switches the language", () => {
    renderMenu();
    fireEvent.click(within(open()).getByRole("menuitemradio", { name: "English" }));
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
  });

  it("saves the theme under plania_theme and applies it as before", () => {
    renderMenu();
    expect(within(open()).getByRole("menuitemradio", { name: "Sistema" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oscuro" }));
    expect(window.localStorage.getItem("plania_theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.click(within(open()).getByRole("menuitemradio", { name: "Claro" }));
    expect(window.localStorage.getItem("plania_theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows the system preference when the theme is system", () => {
    window.localStorage.setItem("plania_theme", "light");
    mockMatchMedia((query) => query === "(prefers-color-scheme: dark)");
    renderMenu();
    fireEvent.click(within(open()).getByRole("menuitemradio", { name: "Sistema" }));
    expect(window.localStorage.getItem("plania_theme")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("replays the tour and signs out, closing the menu", () => {
    const h = renderMenu();
    fireEvent.click(within(open()).getByRole("menuitem", { name: "Ver el tour de la app" }));
    expect(h.onStartTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(within(open()).getByRole("menuitem", { name: "Cerrar sesión" }));
    expect(h.onSignOut).toHaveBeenCalledTimes(1);
  });

  it("offers sign in instead of sign out to an anonymous user", () => {
    const h = renderMenu({ email: null });
    const menu = open();
    expect(within(menu).queryByRole("menuitem", { name: "Cerrar sesión" })).toBeNull();
    expect(within(menu).getByRole("menuitemradio", { name: "English" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Ver el tour de la app" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Iniciar sesión" }));
    expect(h.onSignIn).toHaveBeenCalledTimes(1);
  });

  it("links to the trip list and the profile", () => {
    renderMenu();
    const menu = open();
    expect(within(menu).getByRole("menuitem", { name: "Mis viajes" }).getAttribute("href")).toBe("/trips");
    expect(within(menu).getByRole("menuitem", { name: "Perfil" }).getAttribute("href")).toBe("/me");
  });

  it("leaves the tour out where there is no trip to tour", () => {
    renderMenu({ onStartTour: undefined });
    expect(within(open()).queryByRole("menuitem", { name: "Ver el tour de la app" })).toBeNull();
  });
});
