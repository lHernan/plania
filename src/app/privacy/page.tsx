import { permanentRedirect } from "next/navigation";

/** /privacy — the English-friendly address of the privacy policy, which lives at /privacidad. */
export default function PrivacyAlias() {
  permanentRedirect("/privacidad");
}
