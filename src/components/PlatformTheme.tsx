"use client";

import { useEffect } from "react";

function detectPlatform() {
  if (typeof navigator === "undefined") return "web";

  const agent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const isIos =
    /iphone|ipad|ipod/.test(agent) ||
    (platform === "macintel" && maxTouchPoints > 1);

  if (isIos) return "ios";
  if (agent.includes("android")) return "android";
  return "web";
}

export function PlatformTheme() {
  useEffect(() => {
    const platform = detectPlatform();
    document.documentElement.dataset.platform = platform;

    return () => {
      delete document.documentElement.dataset.platform;
    };
  }, []);

  return null;
}
