import { describe, expect, it } from "vitest";
import { buildEmailHtml, inviteTarget, toShareLink } from "../../supabase/functions/notify-trip-share/email";

const APP = "https://tachao.app/";

describe("notify-trip-share email", () => {
  it("only accepts a share page of the app as the invitation link", () => {
    expect(toShareLink("https://tachao.app/share/abc-123", APP)).toBe("https://tachao.app/share/abc-123");
    expect(toShareLink("https://evil.com/share/abc", APP)).toBeNull();
    expect(toShareLink("https://tachao.app/trips", APP)).toBeNull();
    expect(toShareLink("javascript:alert(1)", APP)).toBeNull();
    expect(toShareLink(42, APP)).toBeNull();
  });

  it("falls back to the trips page without a double slash", () => {
    expect(inviteTarget(undefined, APP)).toBe("https://tachao.app/trips");
    expect(inviteTarget("https://tachao.app/share/tok", APP)).toBe("https://tachao.app/share/tok");
  });

  it("puts the sign-in link in the button and escapes what the owner typed", () => {
    const html = buildEmailHtml({
      tripName: 'La Palma <img src=x onerror="alert(1)">',
      ownerEmail: "ana@test.com",
      ctaUrl: "https://project.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=https://tachao.app/share/tok",
    });
    expect(html).toContain('href="https://project.supabase.co/auth/v1/verify?token=abc&amp;type=magiclink&amp;redirect_to=https://tachao.app/share/tok"');
    expect(html).toContain("La Palma &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("also shows the share link, which keeps working after the one-time sign-in link expires", () => {
    const html = buildEmailHtml({ tripName: "La Palma", ownerEmail: "ana@test.com", ctaUrl: "https://project.supabase.co/auth/v1/verify?token=abc", shareUrl: "https://tachao.app/share/tok" });
    expect(html).toContain('<a href="https://tachao.app/share/tok"');
    expect(html).toContain(">https://tachao.app/share/tok</a>");
    expect(buildEmailHtml({ tripName: "x", ownerEmail: "y", ctaUrl: "https://tachao.app/share/tok", shareUrl: "https://tachao.app/share/tok" })).not.toContain(">https://tachao.app/share/tok</a>");
  });
});
