"use client";

import { useEffect } from "react";

/**
 * PwaRegister - Now acts as a PwaUnregister.
 * The previous service worker was aggressively caching the app root,
 * causing users to see stale versions of the app even after deployment.
 */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
          console.log("Plania [pwa]: Unregistered service worker", registration);
        }
      });
      
      // Also clear caches to be absolutely sure
      if ("caches" in window) {
        caches.keys().then((names) => {
          for (const name of names) {
            caches.delete(name);
            console.log("Plania [pwa]: Deleted cache", name);
          }
        });
      }
    }
  }, []);

  return null;
}
