function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJson<T>(content: string, open: string, close: string): T | null {
  const normalized = stripCodeFence(content);
  const directStart = normalized.indexOf(open);
  const directEnd = normalized.lastIndexOf(close);
  if (directStart === -1 || directEnd <= directStart) return null;

  try {
    return JSON.parse(normalized.slice(directStart, directEnd + 1)) as T;
  } catch {
    return null;
  }
}

export function extractJsonObject<T>(content: string) {
  return extractJson<T>(content, "{", "}");
}

export function extractJsonArray<T>(content: string) {
  return extractJson<T>(content, "[", "]");
}
