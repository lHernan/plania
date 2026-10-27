/**
 * Asks the notify-trip-share Edge Function to email an invitation. The function only acts on
 * calls carrying NOTIFY_TRIP_SHARE_SECRET (set the same value in the app and as a function
 * secret), so the public anon key cannot be used to send invitations or create accounts.
 * Without the secret no email is sent; access still works (claim on sign-in, share link).
 */
export async function notifyTripShare(payload: {
  tripId: string;
  tripName: string;
  inviteeEmail: string;
  ownerEmail: string;
  shareUrl?: string;
  role?: string;
}): Promise<void> {
  const secret = process.env.NOTIFY_TRIP_SHARE_SECRET;
  if (!secret) {
    console.warn("notify-trip-share skipped: NOTIFY_TRIP_SHARE_SECRET is not set");
    return;
  }
  try {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-trip-share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "x-notify-secret": secret,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("notify-trip-share edge function error:", error);
  }
}
