/**
 * Pure helpers of the notify-trip-share email (no Deno APIs), so they can be tested with Vitest.
 */

/** Only a share page (/share/<token>) of the app itself is used as the invitation target. */
export function toShareLink(value: unknown, appUrl: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.host !== new URL(appUrl).host) return null;
    return /^\/share\/[\w-]+$/.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The invitation's share link, or the trips page when there is none. */
export function inviteTarget(shareUrl: unknown, appUrl: string): string {
  return toShareLink(shareUrl, appUrl) ?? `${appUrl.replace(/\/+$/, "")}/trips`;
}

/**
 * Only the app may trigger invitations: the call must carry the shared secret. With no secret
 * configured nothing is accepted. The comparison takes the same time wherever it differs.
 */
export function isAuthorizedCall(provided: string | null, secret: string | undefined): boolean {
  if (!secret || typeof provided !== "string" || provided.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i += 1) diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** The trip name and the owner's email are typed by people: never raw HTML in the email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildEmailHtml({
  tripName,
  ownerEmail,
  ctaUrl,
  shareUrl,
}: {
  tripName: string;
  ownerEmail: string;
  /** Signs the invitee in and opens the trip when possible; otherwise the share link. */
  ctaUrl: string;
  /** Shown as text too when the button is a one-time sign-in link that can expire. */
  shareUrl?: string;
}): string {
  const trip = escapeHtml(tripName);
  const owner = escapeHtml(ownerEmail);
  const href = escapeHtml(ctaUrl);
  const fallback = shareUrl && shareUrl !== ctaUrl ? escapeHtml(shareUrl) : null;
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
                <strong style="color:#4f46e5;">${owner}</strong> te ha invitado a ver el itinerario de:
              </p>

              <!-- Trip card -->
              <div style="background:#f1f5f9;border-radius:16px;padding:20px 24px;margin-bottom:28px;border-left:4px solid #4f46e5;">
                <p style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 6px;">Viaje compartido</p>
                <p style="font-size:18px;font-weight:900;color:#0f172a;margin:0;">${trip}</p>
              </div>

              <p style="font-size:13px;color:#94a3b8;margin:0 0 24px;line-height:1.6;">
                Puedes visualizar todos los días, actividades y reservaciones del viaje. Inicia sesión en Plania para verlo.
              </p>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${href}"
                       style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:2px;padding:16px 36px;border-radius:50px;text-decoration:none;box-shadow:0 8px 24px rgba(79,70,229,0.3);">
                      Ver mi viaje compartido
                    </a>
                  </td>
                </tr>
              </table>
              ${fallback ? `<p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.6;text-align:center;">Si el botón ya no funciona, abre este enlace e inicia sesión:<br/><a href="${fallback}" style="color:#4f46e5;word-break:break-all;">${fallback}</a></p>` : ""}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">
                Si no conoces a <strong>${owner}</strong>, puedes ignorar este mensaje.<br/>
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
