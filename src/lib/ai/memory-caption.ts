import type { SummaryLang } from "@/lib/ai/trip-summary";

/**
 * Suggested photo caption (S4). Text only: the photo itself is never sent to the AI.
 */

export const CAPTION_MAX = 120;
const FIELD_MAX = 300;

export type CaptionContext = {
  tripName?: string | null;
  city?: string | null;
  activityTitle?: string | null;
  note?: string | null;
};

const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, FIELD_MAX) : null);

export function captionContext(source: Record<string, unknown>): CaptionContext {
  return {
    tripName: clean(source.tripName),
    city: clean(source.city),
    activityTitle: clean(source.activityTitle),
    note: clean(source.note),
  };
}

export const hasCaptionContext = (context: CaptionContext) => Object.values(context).some(Boolean);

export function buildCaptionPrompts(context: CaptionContext, lang: SummaryLang) {
  const language = lang === "es" ? "Spanish" : "English";
  const system = [
    "You are Tachi, a travel companion. Suggest one short caption for a travel photo from the traveler's description of the moment.",
    `Write in ${language}. At most ${CAPTION_MAX} characters, one line, no quotes, no hashtags, no emojis, no markdown.`,
    "Use only the facts provided; never invent people or details.",
  ].join("\n");
  const facts = Object.fromEntries(Object.entries(context).filter(([, value]) => Boolean(value)));
  return { system, user: `Moment (JSON):\n${JSON.stringify(facts)}` };
}

/** One line, without quotes or markdown, cut at a word boundary to CAPTION_MAX characters. */
export function cleanCaption(raw: string): string {
  const line = (raw.trim().split("\n").find((part) => part.trim()) ?? "")
    .replace(/[*#`]/g, "")
    .trim()
    .replace(/^["'“”«»]+|["'“”«»]+$/g, "")
    .trim();
  if (line.length <= CAPTION_MAX) return line;
  const cut = line.slice(0, CAPTION_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > CAPTION_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}
