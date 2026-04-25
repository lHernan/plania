"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/use-auth-store";

export function AuthInitializer() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return null;
}
