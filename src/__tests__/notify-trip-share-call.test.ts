import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyTripShare } from "@/lib/share/notify";
import { isAuthorizedCall } from "../../supabase/functions/notify-trip-share/email";

const payload = { tripId: "t1", tripName: "La Palma", inviteeEmail: "ana@test.com", ownerEmail: "yo@test.com", shareUrl: "https://tachao.app/share/tok" };

describe("notifyTripShare (app side)", () => {
  const fetchMock = vi.fn(async () => new Response("{}"));
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("calls the function with the shared secret", async () => {
    vi.stubEnv("NOTIFY_TRIP_SHARE_SECRET", "s3cret");
    await notifyTripShare(payload);
    expect(fetchMock).toHaveBeenCalledWith("https://project.supabase.co/functions/v1/notify-trip-share", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer service-key", "x-notify-secret": "s3cret" },
      body: JSON.stringify(payload),
    });
  });

  it("sends nothing while the secret is not configured", async () => {
    vi.stubEnv("NOTIFY_TRIP_SHARE_SECRET", "");
    await notifyTripShare(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the function is unreachable", async () => {
    vi.stubEnv("NOTIFY_TRIP_SHARE_SECRET", "s3cret");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(notifyTripShare(payload)).resolves.toBeUndefined();
  });
});

describe("isAuthorizedCall (function side)", () => {
  it("accepts only the configured secret", () => {
    expect(isAuthorizedCall("s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCall("s3creT", "s3cret")).toBe(false);
    expect(isAuthorizedCall("s3cret-longer", "s3cret")).toBe(false);
    expect(isAuthorizedCall(null, "s3cret")).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCall("", "")).toBe(false);
    expect(isAuthorizedCall("anything", undefined)).toBe(false);
  });
});
