import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { I18nProvider } from "@/components/I18nProvider";
import { AuthInitializer } from "@/components/AuthInitializer";
import { OfflineStatus } from "@/components/OfflineStatus";
import { PlatformTheme } from "@/components/PlatformTheme";
import { Suspense } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
