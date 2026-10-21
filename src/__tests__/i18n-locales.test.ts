import { describe, it, expect } from "vitest";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

describe("i18n locales", () => {
  it("en and es have the same set of keys", () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("new landing keys exist in both locales", () => {
    const required = [
      "landing_loading",
      "landing_tagline",
      "landing_quick_start",
      "landing_trip_name",
      "landing_trip_name_placeholder",
      "landing_start_date",
      "landing_end_date",
      "landing_create_adventure",
      "landing_creating",
      "landing_enter_trip_name",
      "landing_have_account",
      "landing_sign_in_sync",
      "landing_logged_in_as",
      "landing_no_trips_yet",
    ];
    for (const key of required) {
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((es as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it("new share keys exist in both locales", () => {
    const required = [
      "share_title",
      "share_invite_by_email",
      "share_email_placeholder",
      "share_send",
      "share_sending",
      "share_people_with_access",
      "share_no_access_yet",
      "share_revoke_access",
      "share_revoke_confirm",
      "share_footer_note",
      "share_invalid_email",
      "share_success",
      "share_error_generic",
      "share_error_connection",
      "share_revoking",
    ];
    for (const key of required) {
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((es as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it("share_success and landing_logged_in_as support interpolation", () => {
    expect((es as Record<string, string>)["share_success"]).toContain("{email}");
    expect((es as Record<string, string>)["landing_logged_in_as"]).toContain("{email}");
  });
});