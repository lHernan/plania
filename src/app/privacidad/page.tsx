import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/legal/PrivacyPolicy";

export const metadata: Metadata = {
  title: "Privacidad · Privacy · Tachao",
  description: "Política de privacidad de Tachao: qué datos tratamos, para qué y tus derechos. Privacy policy in English included.",
};

/** /privacidad — the public privacy policy (Spanish and English), no sign-in needed. */
export default function PrivacyPage() {
  return <PrivacyPolicy />;
}
