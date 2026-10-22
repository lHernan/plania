import { Activity } from "@/lib/types";
import { extractJsonArray } from "@/lib/ai/json-response";
import { runAiPrompt, runAiVision } from "@/lib/ai/provider";

export const geminiService = {
  async detectCodeRegions(imageUri: string): Promise<{ type: string; x: number; y: number; width: number; height: number; label: string }[]> {
    const systemPrompt = `You are a document analyzer.
Identify ALL QR codes and Barcodes in the provided image.
Return a JSON array of objects with the following structure:
[{"type": "qr" | "barcode", "x": number, "y": number, "width": number, "height": number, "label": "string description"}]
Coordinates (x, y, width, height) must be NORMALIZED (0-100) relative to the image size.
x, y represent the CENTER of the code.
Return ONLY the JSON array.`;

    const userPrompt = "Find all scan codes in this boarding pass.";

    try {
      const result = await runAiVision(systemPrompt, userPrompt, imageUri);
      return extractJsonArray(result) ?? [];
    } catch (e) {
      console.error("detectCodeRegions failed:", e);
    }
    return [];
  },

  async compareLocations(locations: string[]): Promise<string[][]> {
    if (locations.length < 2) return locations.map(l => [l]);

    const systemPrompt = `You are a semantic matching tool.
Given a list of location strings, your task is to group the ones that refer to the exact same place.
Return ONLY a valid JSON array of arrays of strings. No markdown, no explanations.
Example: [["Mercado de África", "Mercado de Nuestra Señora de África"], ["Airport"], ["Hotel Plaza", "Plaza Hotel"]]`;

    const userPrompt = JSON.stringify(locations);

    try {
      const result = await runAiPrompt(systemPrompt, userPrompt);
      return extractJsonArray(result) ?? locations.map(l => [l]);
    } catch (e) {
      console.error("compareLocations failed:", e);
    }
    // Fallback: each location in its own group
    return locations.map(l => [l]);
  },

  async inferMissingSteps(activities: Activity[], lang?: string): Promise<{ title: string; category: string; notes: string }[]> {
    if (!activities.length) return [];

    const langRule = lang === "es"
      ? "IMPORTANT: All title and notes values MUST be written in Spanish."
      : "Write all title and notes values in English.";

    const systemPrompt = `You are an intelligent travel assistant.
Review the following list of activities for a day.
Suggest any obvious missing steps that the user should take to make the day run smoothly.
For example: If there's an activity far away, suggest "Travel to X". If they go out at night, suggest "Take a taxi back".
Return ONLY a valid JSON array of objects.
Format: [{"title": "string", "category": "string", "notes": "string"}]
category MUST be one of: food, shopping, sightseeing, hotel, transport, reservation, photos, nightlife, other.
If no steps are missing, return an empty array [].
${langRule}
Do NOT return markdown.`;

    const userPrompt = JSON.stringify(activities.map(a => ({
      title: a.title,
      time: a.time,
      location: a.location,
      category: a.category
    })));

    try {
      const result = await runAiPrompt(systemPrompt, userPrompt);
      return extractJsonArray(result) ?? [];
    } catch (e) {
      console.error("inferMissingSteps failed:", e);
    }
    return [];
  },

  async validateTimelineWithAI(activities: Activity[]): Promise<any[]> {
    if (!activities.length) return activities;

    const systemPrompt = `You are a strict, logical travel itinerary validator.
You will receive an array of JSON objects representing a single day's travel sequence.
Your job is to:
1. Ensure chronological correctness (no impossible time-travel).
2. Understand travel dependencies: "Go to airport" -> "Flight departure" -> "Layover" -> "Flight arrival" -> "Transport to accommodation".
3. If an activity is out of order (e.g., transport to accommodation BEFORE a flight arrival), MOVE it to the correct chronological position.
4. Extract flight intelligence: if notes or titles mention a layover, split the flight and insert "Layover in [City]" as a distinct step.
5. Assign or adjust times ("HH:MM") logically if they are conflicting or if you inject new steps.
6. You MUST return ONLY a JSON array of the corrected sequence of activities.
7. The JSON objects must contain: id (keep existing, or emit a new string like "ai-gen" for injected steps), title, time, category, durationMin, notes.
8. Do NOT wrap in markdown or code blocks. Return just the raw array.`;

    const userPrompt = JSON.stringify(activities.map(a => ({
      id: a.id,
      title: a.title,
      time: a.time,
      location: a.location,
      category: a.category,
      durationMin: a.durationMin,
      notes: a.notes
    })));

    try {
      const result = await runAiPrompt(systemPrompt, userPrompt);
      return extractJsonArray(result) ?? activities;
    } catch (e) {
      console.error("validateTimelineWithAI failed:", e);
    }
    // Fallback: return original sequence if parsing fails
    return activities;
  }
};
