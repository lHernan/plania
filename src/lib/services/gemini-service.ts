import { Activity } from "@/lib/types";

interface ProviderConfig {
  url: string;
  key: string;
  models: string;
}

async function callAI(url: string, key: string, model: string, payload: any) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key
    },
    body: JSON.stringify({
      model: model,
      messages: payload,
      temperature: 0.1,
      max_tokens: 4000
    })
  });
}

async function tryModelsForProvider(config: ProviderConfig, payload: any) {
  const modelList = config.models.split(",").map(m => m.trim()).filter(Boolean);
  let lastResponse: Response | null = null;

  for (const model of modelList) {
    if (!model) continue;
    try {
      const res = await callAI(config.url, config.key, model, payload);
      if (res.ok) {
        return { success: true, response: res };
      }
      lastResponse = res;
      if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) {
        return { success: false, response: res };
      }
    } catch (e) {
      console.error("Fetch error for model " + model + ":", e);
    }
  }
  return { success: false, response: lastResponse };
}

async function runGeminiPrompt(systemPrompt: string, userPrompt: string) {
  const payload = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const primaryConfig = {
    url: process.env.AI_API_URL || "",
    key: process.env.AI_API_KEY || "",
    models: process.env.AI_MODEL || "gpt-4o-mini"
  };

  if (!primaryConfig.key || !primaryConfig.url) {
    throw new Error("Primary AI configuration missing");
  }

  let result = await tryModelsForProvider(primaryConfig, payload);

  if (!result.success && result.response && [500, 502, 503, 504, 429].includes(result.response.status)) {
    const fallbackConfig = {
      url: process.env.AI_FALLBACK_API_URL || "",
      key: process.env.AI_FALLBACK_API_KEY || "",
      models: process.env.AI_FALLBACK_MODEL || ""
    };
    if (fallbackConfig.key && fallbackConfig.url && fallbackConfig.models) {
      result = await tryModelsForProvider(fallbackConfig, payload);
    }
  }

  const res = result.response;
  if (!result.success || !res) {
    throw new Error("AI Provider error");
  }

  const data = await res.json();
  const content =
    data.choices?.[0]?.message?.content ||
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
    
  return content;
}

export const geminiService = {
  async compareLocations(locations: string[]): Promise<string[][]> {
    if (locations.length < 2) return locations.map(l => [l]);

    const systemPrompt = `You are a semantic matching tool.
Given a list of location strings, your task is to group the ones that refer to the exact same place.
Return ONLY a valid JSON array of arrays of strings. No markdown, no explanations.
Example: [["Mercado de África", "Mercado de Nuestra Señora de África"], ["Airport"], ["Hotel Plaza", "Plaza Hotel"]]`;

    const userPrompt = JSON.stringify(locations);

    try {
      const result = await runGeminiPrompt(systemPrompt, userPrompt);
      const jsonStart = result.indexOf("[");
      const jsonEnd = result.lastIndexOf("]");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        return JSON.parse(result.slice(jsonStart, jsonEnd + 1));
      }
    } catch (e) {
      console.error("compareLocations failed:", e);
    }
    // Fallback: each location in its own group
    return locations.map(l => [l]);
  },

  async inferMissingSteps(activities: Activity[]): Promise<{ title: string; category: string; notes: string }[]> {
    if (!activities.length) return [];

    const systemPrompt = `You are an intelligent travel assistant.
Review the following list of activities for a day.
Suggest any obvious missing steps that the user should take to make the day run smoothly.
For example: If there's an activity far away, suggest "Travel to X". If they go out at night, suggest "Take a taxi back".
Return ONLY a valid JSON array of objects.
Format: [{"title": "string", "category": "string", "notes": "string"}]
category MUST be one of: food, shopping, sightseeing, hotel, transport, reservation, photos, nightlife, other.
If no steps are missing, return an empty array [].
Do NOT return markdown.`;

    const userPrompt = JSON.stringify(activities.map(a => ({
      title: a.title,
      time: a.time,
      location: a.location,
      category: a.category
    })));

    try {
      const result = await runGeminiPrompt(systemPrompt, userPrompt);
      const jsonStart = result.indexOf("[");
      const jsonEnd = result.lastIndexOf("]");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        return JSON.parse(result.slice(jsonStart, jsonEnd + 1));
      }
    } catch (e) {
      console.error("inferMissingSteps failed:", e);
    }
    return [];
  }
};
