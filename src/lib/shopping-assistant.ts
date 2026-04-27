import type {
  Activity,
  ShoppingAssistantRequest,
  ShoppingAssistantResponse,
  ShoppingAssistantSuggestionInput,
  ShoppingAssistantWishlistInput,
  ShoppingCategory,
  ShoppingCandidatePlace,
  ShoppingItem,
  ShoppingSuggestion,
} from "@/lib/types";

const INPUT_PLACEHOLDER = "Add things to buy (e.g. Japanese knife, souvenirs, sneakers...)";

const CATEGORY_KEYWORDS: { category: ShoppingCategory; keywords: string[] }[] = [
  { category: "souvenir", keywords: ["souvenir", "gift", "postcard", "magnet", "keychain"] },
  { category: "fashion", keywords: ["sneaker", "shoe", "bag", "jacket", "shirt", "jeans", "fashion"] },
  { category: "beauty", keywords: ["skincare", "makeup", "serum", "beauty", "cosmetic", "perfume"] },
  { category: "food", keywords: ["tea", "coffee", "snack", "chocolate", "spice", "food", "sweets"] },
  { category: "home", keywords: ["knife", "ceramic", "plate", "bowl", "home", "kitchen", "cookware"] },
  { category: "electronics", keywords: ["camera", "headphone", "charger", "console", "electronics", "phone"] },
];

const PHRASE_ITEM_MAP: { pattern: RegExp; name: string }[] = [
  // Spanish
  { pattern: /\bcuchillo\s+japon(?:e|é)s\b/gi, name: "Japanese Knife" },
  { pattern: /\bim[aá]n(?:es)?\b/gi, name: "Magnets" },
  { pattern: /\bmedias\b/gi, name: "Socks" },
  { pattern: /\bzapatillas\b/gi, name: "Sneakers" },
  { pattern: /\brecuerdos\b/gi, name: "Souvenirs" },
  { pattern: /\bskincare\b/gi, name: "Skincare" },
  // English
  { pattern: /\bjapanese\s+knife\b/gi, name: "Japanese Knife" },
  { pattern: /\bmagnet(?:s)?\b/gi, name: "Magnets" },
  { pattern: /\bsock(?:s)?\b/gi, name: "Socks" },
  { pattern: /\bsneaker(?:s)?\b/gi, name: "Sneakers" },
  { pattern: /\bsouvenir(?:s)?\b/gi, name: "Souvenirs" },
];

const CITY_HINTS: Record<string, { country: string; items: Record<string, ShoppingCandidatePlace[]> }> = {
  tokyo: {
    country: "Japan",
    items: {
      knife: [{ name: "Kappabashi Street", area: "Asakusa" }],
      skincare: [{ name: "Matsumoto Kiyoshi", area: "Shibuya" }],
      sneakers: [{ name: "ABC-MART Grand Stage", area: "Shibuya" }],
      souvenirs: [{ name: "Nakamise Shopping Street", area: "Asakusa" }],
      magnets: [{ name: "Nakamise Shopping Street", area: "Asakusa" }],
      socks: [{ name: "UNIQLO Ginza", area: "Ginza" }],
      fashion: [{ name: "UNIQLO Ginza", area: "Ginza" }],
    },
  },
  osaka: {
    country: "Japan",
    items: {
      knife: [{ name: "Sennichimae Doguyasuji", area: "Namba" }],
      souvenirs: [{ name: "Shinsaibashi-suji", area: "Shinsaibashi" }],
      sneakers: [{ name: "Shinsaibashi PARCO", area: "Shinsaibashi" }],
    },
  },
  seoul: {
    country: "South Korea",
    items: {
      skincare: [{ name: "Olive Young Flagship", area: "Myeongdong" }],
      souvenirs: [{ name: "Insadong Street", area: "Insadong" }],
      sneakers: [{ name: "Musinsa Standard", area: "Hongdae" }],
    },
  },
  paris: {
    country: "France",
    items: {
      souvenirs: [{ name: "Rue de Rivoli Boutiques", area: "1st arrondissement" }],
      fashion: [{ name: "Galeries Lafayette", area: "9th arrondissement" }],
    },
  },
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return normalizeWhitespace(value).toLowerCase();
}

function titleCase(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferCategory(name: string): ShoppingCategory {
  const normalized = normalizeKey(name);
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.category;
    }
  }
  return "other";
}

function inferPriority(name: string) {
  const normalized = normalizeKey(name);
  if (/(knife|ring|watch|electronics|camera|skincare)/.test(normalized)) return "high" as const;
  if (/(souvenir|gift|snack|tea|coffee)/.test(normalized)) return "medium" as const;
  return "low" as const;
}

function inferLocationPreference(name: string) {
  const normalized = normalizeKey(name);
  if (normalized.includes("japanese knife")) {
    return {
      preferred_cities: ["Tokyo", "Osaka"],
      preferred_country: "Japan",
    };
  }

  if (normalized.includes("k-beauty") || normalized.includes("k beauty")) {
    return {
      preferred_cities: ["Seoul"],
      preferred_country: "South Korea",
    };
  }

  return {
    preferred_cities: null,
    preferred_country: null,
  };
}

function splitWishlistText(text: string) {
  return text
    .replace(/\band\b/gi, ",")
    .replace(/\by\b/gi, ",")
    .replace(/\be\b/gi, ",")
    .replace(/\bi want to buy\b/gi, "")
    .replace(/\bneed to buy\b/gi, "")
    .replace(/\bquiero comprar\b/gi, "")
    .replace(/\bnecesito comprar\b/gi, "")
    .replace(/\bcomprar\b/gi, "")
    .replace(/\bbuy\b/gi, "")
    .split(/[,\n;]+/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function extractMappedWishlistItems(rawText: string) {
  let remaining = rawText;
  const extracted: string[] = [];

  for (const entry of PHRASE_ITEM_MAP) {
    if (entry.pattern.test(remaining)) {
      extracted.push(entry.name);
      remaining = remaining.replace(entry.pattern, " ");
    }
  }

  return {
    extracted,
    remaining: normalizeWhitespace(remaining),
  };
}

function emptyResponse(): ShoppingAssistantResponse {
  return {
    ui: {
      input_mode: "textbox",
      input_placeholder: INPUT_PLACEHOLDER,
      list_style: "todo",
      show_suggestions_card: false,
    },
    wishlist_items: [],
    suggestions: [],
  };
}

function parseWishlistInput(input: ShoppingAssistantWishlistInput): ShoppingAssistantResponse {
  const response = emptyResponse();
  const existingKeys = new Set((input.shopping_list ?? []).map((item) => normalizeKey(item.name)));
  const seenKeys = new Set<string>();

  const mapped = extractMappedWishlistItems(input.text);
  const rawItems = [...mapped.extracted, ...splitWishlistText(mapped.remaining || input.text)];

  for (const rawItem of rawItems) {
    const normalizedName = titleCase(rawItem);
    const key = normalizeKey(normalizedName);
    if (!key || existingKeys.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const locationPreference = inferLocationPreference(normalizedName);
    response.wishlist_items.push({
      id: "",
      name: normalizedName,
      category: inferCategory(normalizedName),
      notes: null,
      preferred_cities: locationPreference.preferred_cities,
      preferred_country: locationPreference.preferred_country,
      priority: inferPriority(normalizedName),
      status: "pending",
    });
  }

  return response;
}

function extractKeyTerm(item: ShoppingItem) {
  const normalized = normalizeKey(item.name);
  if (normalized.includes("knife")) return "knife";
  if (normalized.includes("skincare")) return "skincare";
  if (normalized.includes("sneaker")) return "sneakers";
  if (normalized.includes("souvenir") || normalized.includes("gift")) return "souvenirs";
  if (normalized.includes("fashion")) return "fashion";
  return normalized.split(" ")[0] || normalized;
}

function findHostOrFallbackPlaces(input: ShoppingAssistantSuggestionInput, item: ShoppingItem) {
  const itemKey = extractKeyTerm(item);
  const hostMatches = (input.candidate_places ?? []).filter((place) => {
    const haystack = normalizeKey(`${place.name} ${place.area ?? ""}`);
    return haystack.includes(itemKey) || item.category === "souvenir";
  });
  if (hostMatches.length > 0) return hostMatches.slice(0, 2);

  const cityHints = CITY_HINTS[normalizeKey(input.day.city)];
  if (!cityHints) return [];

  const hintCandidates = cityHints.items[itemKey] ?? cityHints.items[item.category] ?? [];
  if (hintCandidates.length === 0) return [];

  // If the itinerary already has an activity near the hint, prefer that exact place string.
  const candidateText = (input.candidate_places ?? [])
    .map((place) => normalizeKey(`${place.name} ${place.area ?? ""}`))
    .join(" | ");
  const hinted = hintCandidates.filter((hint) => candidateText.includes(normalizeKey(hint.name)));
  if (hinted.length > 0) return hinted.slice(0, 2);

  return hintCandidates.slice(0, 2);
}

function getSuggestionTime(itinerary: Activity[]) {
  const sorted = [...itinerary].sort((left, right) => left.time.localeCompare(right.time));
  if (sorted.length === 0) return "15:00";
  if (sorted.length === 1) return sorted[0].time >= "18:00" ? "20:00" : "17:30";

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const currentMinutes = Number(current.time.split(":")[0]) * 60 + Number(current.time.split(":")[1]);
    const nextMinutes = Number(next.time.split(":")[0]) * 60 + Number(next.time.split(":")[1]);
    if (nextMinutes - currentMinutes >= 120) {
      const candidateMinutes = currentMinutes + 60;
      const hours = Math.floor(candidateMinutes / 60).toString().padStart(2, "0");
      const minutes = (candidateMinutes % 60).toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    }
  }

  const last = sorted[sorted.length - 1];
  const lastMinutes = Number(last.time.split(":")[0]) * 60 + Number(last.time.split(":")[1]) + 90;
  const hours = Math.min(22, Math.floor(lastMinutes / 60)).toString().padStart(2, "0");
  const minutes = (lastMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildSuggestion(input: ShoppingAssistantSuggestionInput, item: ShoppingItem): ShoppingSuggestion | null {
  if (item.status !== "pending") return null;

  const cityMatches = item.preferred_cities?.some((city) => normalizeKey(city) === normalizeKey(input.day.city)) ?? false;
  const countryMatches = item.preferred_country
    ? normalizeKey(item.preferred_country) === normalizeKey(input.day.country)
    : false;

  const places = findHostOrFallbackPlaces(input, item);
  let confidence = 0.45;
  if (cityMatches) confidence += 0.25;
  else if (countryMatches) confidence += 0.15;
  if (places.length > 0) confidence += 0.2;
  if (item.priority === "high") confidence += 0.08;
  if (input.itinerary.some((activity) => normalizeKey(activity.category) === "shopping")) confidence += 0.05;
  const placeMentionedInDay = places.some((place) =>
    input.itinerary.some((activity) => normalizeKey(`${activity.location ?? ""} ${activity.title}` as string).includes(normalizeKey(place.name)))
  );
  if (placeMentionedInDay) confidence += 0.1;

  const ignoreKey = `${input.day.date}:${normalizeKey(input.day.city)}:${item.id}`;
  if ((input.ignored_suggestion_keys ?? []).includes(ignoreKey)) return null;
  if (confidence < 0.7) return null;

  const bestPlace = places[0];
  const contextualReason = bestPlace && placeMentionedInDay
    ? `You have an activity near ${bestPlace.name}, which is a strong match for buying this.`
    : places.length > 0
      ? `You are in ${input.day.city} and there is a strong nearby shopping match for this item.`
      : `Today is a good city match for this item and you have time to shop without disrupting the plan.`;

  return {
    shopping_item_id: item.id,
    title: `Buy ${item.name}`,
    reason: contextualReason,
    suggested_time: getSuggestionTime(input.itinerary),
    suggested_duration: item.priority === "high" ? 90 : 75,
    location_suggestions: places,
    confidence: Number(Math.min(0.98, confidence).toFixed(2)),
    ui_hints: {
      can_add_to_plan: true,
      can_ignore: true,
      ignore_key: ignoreKey,
    },
  };
}

function generateSuggestions(input: ShoppingAssistantSuggestionInput): ShoppingAssistantResponse {
  const response = emptyResponse();
  const suggestions = input.shopping_list
    .map((item) => buildSuggestion(input, item))
    .filter((item): item is ShoppingSuggestion => Boolean(item))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);

  response.suggestions = suggestions;
  response.ui.show_suggestions_card = suggestions.length > 0;
  return response;
}

export function runShoppingAssistant(input: ShoppingAssistantRequest): ShoppingAssistantResponse {
  if (input.type === "wishlist_input") {
    return parseWishlistInput(input);
  }

  return generateSuggestions(input);
}
