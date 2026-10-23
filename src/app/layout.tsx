import type { Metadata } from "next";
import { DM_Serif_Display, Inter } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { I18nProvider } from "@/components/I18nProvider";
import { AuthInitializer } from "@/components/AuthInitializer";
import { OfflineStatus } from "@/components/OfflineStatus";
import { PlatformTheme } from "@/components/PlatformTheme";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const dmSerif = DM_Serif_Display({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Plania - Premium Travel Itinerary",
  description: "Mobile-first premium itinerary planner for complex international trips.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${dmSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>
          <PlatformTheme />
          <AuthInitializer />
          <OfflineStatus />
          <PwaRegister />
          <Suspense fallback={null}>
            {children}
          </Suspense>
        </I18nProvider>
      </body>
    </html>
  );
}
