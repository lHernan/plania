/**
 * Supabase Edge Function: notify-trip-share
 *
 * Sends an email notification to the invited user when a trip is shared.
 *
 * Expected body:
 * {
 *   tripId: string;
 *   tripName: string;
 *   inviteeEmail: string;
 *   ownerEmail: string;
 *   shareUrl?: string; // /share/<token> link of the invitation
 * }
 *
 * Only accepts calls with the header x-notify-secret equal to the NOTIFY_TRIP_SHARE_SECRET
 * secret (the app sends it from src/lib/share/notify.ts).
 *
 * Deploy with:
 *   supabase secrets set NOTIFY_TRIP_SHARE_SECRET=<same value as the app>
 *   supabase functions deploy notify-trip-share
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEmailHtml, inviteTarget, isAuthorizedCall } from "./email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://tachao.app/";
/** Same value as the app's NOTIFY_TRIP_SHARE_SECRET: `supabase secrets set NOTIFY_TRIP_SHARE_SECRET=...` */
const NOTIFY_SECRET = Deno.env.get("NOTIFY_TRIP_SHARE_SECRET");

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  // The anon key passes the platform's JWT check, so the app proves itself with a shared secret.
  if (!isAuthorizedCall(req.headers.get("x-notify-secret"), NOTIFY_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { tripId, tripName, inviteeEmail, ownerEmail, shareUrl } = await req.json() as {
      tripId: string;
      tripName: string;
      inviteeEmail: string;
      ownerEmail: string;
      shareUrl?: string;
    };
    // The invitation opens its own share link; anything that is not one falls back to the app.
    const inviteUrl = inviteTarget(shareUrl, APP_URL);

    if (!inviteeEmail || !tripName || !ownerEmail) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // A one-click sign-in that lands on the share link (the redirect URL must be allowed in
    // Supabase Auth). For an email without an account, Supabase turns this into a sign-up link
    // and creates the account (as this function always did); the link confirms it.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: inviteeEmail,
      options: { redirectTo: inviteUrl },
    });
    if (linkError) console.error("generateLink error:", linkError.message);
    const signInLink = linkData?.properties?.action_link ?? null;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Plania <noreply@${new URL(APP_URL).hostname}>`,
          to: inviteeEmail,
          subject: `${ownerEmail} compartió "${tripName}" contigo en Plania`,
          html: buildEmailHtml({ tripName, ownerEmail, ctaUrl: signInLink ?? inviteUrl, shareUrl: inviteUrl }),
        }),
      });

      if (!resendRes.ok) {
        const err = await resendRes.text();
        console.error("Resend error:", err);
        return new Response(JSON.stringify({ error: "Email delivery failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else if (signInLink) {
      // Without Resend, the project's own mailer sends its magic-link email, which lands on the
      // share link too (a confirmation email when generateLink just created the account).
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: inviteeEmail,
        options: { emailRedirectTo: inviteUrl, shouldCreateUser: false },
      });
      if (otpError) console.error("Magic link email error:", otpError.message);
    } else {
      console.warn("No email sent: RESEND_API_KEY is not set and no sign-in link could be generated.");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-trip-share error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
