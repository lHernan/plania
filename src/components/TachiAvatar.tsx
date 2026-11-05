"use client";

export type TachiState = "idle" | "thinking" | "ready" | "error";

/**
 * Tachi, the AI mascot: the one icon for AI anywhere in the app. A provisional original drawing
 * (a speech bubble with a face whose smile is a tick), replaceable by the final illustration.
 * Decorative: the control that carries it names the action.
 */
export function TachiAvatar({ state = "idle", size = 24, className = "" }: { state?: TachiState; size?: number; className?: string }) {
  // Only "thinking" moves, and only for people who did not ask for reduced motion.
  const motion = state === "thinking" ? "motion-safe:animate-pulse" : "";
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-state={state}
      className={`shrink-0 ${motion} ${className}`.trim()}
    >
      {/* Bubble body with a small tail, in the AI accent. */}
      <path
        d="M16 3C8.8 3 3 8.2 3 14.6c0 3.6 1.8 6.8 4.7 8.9L6.5 28.5l5.6-3.1c1.2.3 2.5.5 3.9.5 7.2 0 13-5.2 13-11.3S23.2 3 16 3Z"
        fill="var(--color-accent-ai)"
      />
      {state === "error" ? (
        <g stroke="var(--color-surface)" strokeWidth="2" strokeLinecap="round">
          <path d="M9.8 10.8l3 3M12.8 10.8l-3 3M19.2 10.8l3 3M22.2 10.8l-3 3" />
          <path d="M12 19.5h8" />
        </g>
      ) : (
        <g fill="var(--color-surface)">
          {/* Eyes look up while thinking. */}
          <circle cx="11.5" cy={state === "thinking" ? 11 : 12.5} r="1.9" />
          <circle cx="20.5" cy={state === "thinking" ? 11 : 12.5} r="1.9" />
        </g>
      )}
      {state !== "error" && (
        // The smile is a tick: Tachi crosses things off, like the app.
        <path
          d={state === "thinking" ? "M13 19h6" : "M11.5 18.2l3 2.8 6-5.2"}
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {state === "ready" && <circle cx="26.5" cy="5.5" r="2.5" fill="var(--color-success)" />}
    </svg>
  );
}
