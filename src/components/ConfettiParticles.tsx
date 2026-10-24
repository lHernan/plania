"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const COLORS = [
  "var(--color-primary)",
  "var(--color-success)",
  "var(--color-accent-ai)",
  "var(--color-celebration)",
  "var(--color-warning)",
];

type Particle = {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  driftX: number;
  driftY: number;
  duration: number;
  round: boolean;
};

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: -10 - Math.random() * 20,
    size: 6 + Math.random() * 6,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * 360,
    driftX: (Math.random() - 0.5) * 60,
    driftY: 80 + Math.random() * 40,
    duration: 1.5 + Math.random() * 1.5,
    round: Math.random() > 0.5,
  }));
}

export function ConfettiParticles({ count }: { count: number }) {
  const reduced = useReducedMotion();
  const particles = useMemo(() => generateParticles(count), [count]);

  if (reduced) return null;

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-[131]">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            rotate: 0,
            opacity: 1,
          }}
          animate={{
            top: `${p.y + p.driftY}%`,
            left: `${p.x + p.driftX}%`,
            rotate: p.rotation,
            opacity: 0,
          }}
          transition={{
            duration: p.duration,
            ease: "easeOut",
          }}
          style={{
            position: "absolute",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.round ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}
