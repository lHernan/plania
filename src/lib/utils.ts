import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(Math.max(0, minutes) / 60) % 24;
  const m = Math.max(0, minutes) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function getMidpointTime(t1: string, t2: string): string {
  const m1 = timeToMinutes(t1);
  const m2 = timeToMinutes(t2);
  let diff = m2 - m1;
  if (diff < 0) diff += 24 * 60; // Handle wrapping around midnight
  return minutesToTime(m1 + Math.floor(diff / 2));
}

export function addMinutes(time: string, mins: number): string {
  return minutesToTime(timeToMinutes(time) + mins);
}
