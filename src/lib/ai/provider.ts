export type AiTextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiVisionMessage = {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
};

type AiMessage = AiTextMessage | AiVisionMessage;

type ProviderConfig = {
  url: string;
  key: string;
  models: string;
};

type ProviderResult = {
  success: boolean;
  response: Response | null;
};

export type AiRequestOptions = {
  /**
   * Output token budget. Reasoning models spend part of it thinking before they answer,
   * so long JSON replies need more than the default or they come back truncated.
   */
  maxTokens?: number;
};

const DEFAULT_MAX_TOKENS = 4000;

function getProviderConfig(fallback = false): ProviderConfig {
  return fallback
    ? {
        url: process.env.AI_FALLBACK_API_URL || "",
        key: process.env.AI_FALLBACK_API_KEY || "",
        models: process.env.AI_FALLBACK_MODEL || "",
      }
    : {
        url: process.env.AI_API_URL || "",
        key: process.env.AI_API_KEY || "",
        models: process.env.AI_MODEL || "gpt-4o-mini",
      };
}

async function callProvider(config: ProviderConfig, model: string, messages: AiMessage[], maxTokens: number) {
  return fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
  });
}

async function tryModels(config: ProviderConfig, messages: AiMessage[], maxTokens: number): Promise<ProviderResult> {
  const models = config.models.split(",").map((model) => model.trim()).filter(Boolean);
  let lastResponse: Response | null = null;

  for (const model of models) {
    try {
      const response = await callProvider(config, model, messages, maxTokens);
      if (response.ok) return { success: true, response };

      lastResponse = response;
      if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
        return { success: false, response };
      }
    } catch (error) {
      console.error(`AI provider request failed for model ${model}:`, error);
    }
  }

  return { success: false, response: lastResponse };
}

export async function runAiMessages(messages: AiMessage[], options: AiRequestOptions = {}) {
  const primary = getProviderConfig();
  if (!primary.key || !primary.url) {
    throw new Error("Primary AI configuration missing");
  }

  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  let result = await tryModels(primary, messages, maxTokens);
  if (!result.success && result.response && [429, 500, 502, 503, 504].includes(result.response.status)) {
    const fallback = getProviderConfig(true);
    if (fallback.key && fallback.url && fallback.models) {
      result = await tryModels(fallback, messages, maxTokens);
    }
  }

  if (!result.success || !result.response) {
    throw new Error("AI Provider error");
  }

  const data = await result.response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return data.choices?.[0]?.message?.content
    ?? data.candidates?.[0]?.content?.parts?.[0]?.text
    ?? "";
}

export async function runAiPrompt(systemPrompt: string, userPrompt: string, options?: AiRequestOptions) {
  return runAiMessages([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], options);
}

export async function runAiVision(systemPrompt: string, userPrompt: string, imageUri: string) {
  return runAiMessages([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        { type: "image_url", image_url: { url: imageUri } },
      ],
    },
  ]);
}

/** Sends one text part plus several images (e.g. scanned PDF pages) in a single user message. */
export async function runAiVisionPages(systemPrompt: string, userPrompt: string, imageUris: string[]) {
  return runAiMessages([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        ...imageUris.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    },
  ]);
}
