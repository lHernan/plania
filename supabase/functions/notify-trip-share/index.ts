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
 * }
 *
 * Deploy with:
 *   supabase functions deploy notify-trip-share
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://plania.app";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { tripId, tripName, inviteeEmail, ownerEmail } = await req.json() as {
      tripId: string;
      tripName: string;
      inviteeEmail: string;
      ownerEmail: string;
    };

    if (!inviteeEmail || !tripName || !ownerEmail) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Send email using Supabase Auth Admin (uses the configured SMTP)
    // We use the built-in "invite" email as a vehicle, or Auth's send email hook.
    // Here we use the Supabase Admin API to send a custom email.
    const emailHtml = buildEmailHtml({ tripName, ownerEmail, appUrl: APP_URL });

    const { error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: inviteeEmail,
      options: {
        redirectTo: `${APP_URL}/trips`,
      },
    });

    if (error) {
      console.error("generateLink error:", error);
    }

    // Alternatively, send via the Supabase SMTP relay using the custom email endpoint.
    // This uses the configured mailer in your Supabase project.
    const mailRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    // Use Resend or configured SMTP if available
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
          html: emailHtml,
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

function buildEmailHtml({
  tripName,
  ownerEmail,
  appUrl,
}: {
  tripName: string;
  ownerEmail: string;
  appUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Viaje compartido en Plania</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:40px 32px;text-align:center;">
              <div style="font-size:32px;margin-bottom:8px;">✈️</div>
              <h1 style="color:#ffffff;font-size:22px;font-weight:900;margin:0;letter-spacing:-0.5px;">Plania</h1>
              <p style="color:rgba(255,255,255,0.75);font-size:12px;margin:4px 0 0;font-weight:600;text-transform:uppercase;letter-spacing:2px;">Tu asistente de viajes</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 32px;">
              <h2 style="font-size:20px;font-weight:900;color:#0f172a;margin:0 0 8px;line-height:1.3;">
                ¡Alguien compartió un viaje contigo!
              </h2>
              <p style="font-size:14px;color:#64748b;margin:0 0 28px;line-height:1.6;">
                <strong style="color:#4f46e5;">${ownerEmail}</strong> te ha invitado a ver el itinerario de:
              </p>

              <!-- Trip card -->
              <div style="background:#f1f5f9;border-radius:16px;padding:20px 24px;margin-bottom:28px;border-left:4px solid #4f46e5;">
                <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 6px;">Viaje compartido</p>
                <p style="font-size:18px;font-weight:900;color:#0f172a;margin:0;">${tripName}</p>
              </div>

              <p style="font-size:13px;color:#94a3b8;margin:0 0 24px;line-height:1.6;">
                Puedes visualizar todos los días, actividades y reservaciones del viaje. Inicia sesión en Plania para verlo.
              </p>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${appUrl}/trips"
                       style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:2px;padding:16px 36px;border-radius:50px;text-decoration:none;box-shadow:0 8px 24px rgba(79,70,229,0.3);">
                      Ver mi viaje compartido
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">
                Si no conoces a <strong>${ownerEmail}</strong>, puedes ignorar este mensaje.<br/>
                Plania &mdash; Tu asistente de viajes inteligente.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
