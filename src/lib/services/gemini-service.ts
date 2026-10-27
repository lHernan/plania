import { extractJsonArray } from "@/lib/ai/json-response";
import { runAiVision } from "@/lib/ai/provider";

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
  }
};
