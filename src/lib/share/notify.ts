import { after } from "next/server";

type TripSharePayload = {
  tripId: string;
  tripName: string;
  inviteeEmail: string;
  ownerEmail: string;
  shareUrl?: string;
  role?: string;
};

/**
 * Asks the notify-trip-share Edge Function to email an invitation. The function only acts on
 * calls carrying NOTIFY_TRIP_SHARE_SECRET (set the same value in the app and as a function
 * secret), so the public anon key cannot be used to send invitations or create accounts.
 * Without the secret no email is sent; access still works (claim on sign-in, share link).
 */
export async function notifyTripShare(payload: TripSharePayload): Promise<void> {
  const secret = process.env.NOTIFY_TRIP_SHARE_SECRET;
  if (!secret) {
    console.warn("notify-trip-share skipped: NOTIFY_TRIP_SHARE_SECRET is not set");
    return;
  }
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-trip-share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "x-notify-secret": secret,
      },
      body: JSON.stringify(payload),
    });
    // A wrong or missing secret on either side shows up here instead of failing silently.
    if (!response.ok) console.warn(`notify-trip-share refused the invitation email: HTTP ${response.status}`);
  } catch (error) {
    console.warn("notify-trip-share edge function error:", error);
  }
}

/**
 * Sends the invitation after the response, without delaying the share. Inside a request,
 * `after` keeps serverless platforms from cutting the call off once the response is sent.
 */
export function scheduleTripShareNotification(payload: TripSharePayload): void {
  try {
    after(() => notifyTripShare(payload));
  } catch {
    // Outside a request scope (scripts, tests) `after` is not available.
    void notifyTripShare(payload);
  }
}
