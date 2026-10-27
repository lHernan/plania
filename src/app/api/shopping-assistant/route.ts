import { NextResponse } from "next/server";
import { runAiPrompt } from "@/lib/ai/provider";
import { extractJsonObject } from "@/lib/ai/json-response";
import { runShoppingAssistant } from "@/lib/shopping-assistant";
import {
  MAX_SHOPPING_TEXT,
  buildShoppingParseSystemPrompt,
  buildShoppingParseUserPrompt,
  validateParsedItems,
} from "@/lib/shopping/parse-items";
import { getAuthClient } from "@/lib/supabase-server";
import type { ShoppingAssistantRequest, ShoppingAssistantWishlistInput, ShoppingItem } from "@/lib/types";

/** AI split for signed-in users (it spends credits); null means "use the rules". */
async function parseWithAi(request: Request, body: ShoppingAssistantWishlistInput): Promise<ShoppingItem[] | null> {
  const { data, error } = await getAuthClient(request).auth.getUser();
  if (error || !data?.user || data.user.is_anonymous) return null;
  try {
    const content = await runAiPrompt(
      buildShoppingParseSystemPrompt(body.lang === "es" ? "es" : "en"),
      buildShoppingParseUserPrompt(body.text, body.shopping_list ?? []),
      { tier: "fast" },
    );
    const items = validateParsedItems(extractJsonObject<unknown>(content), body.shopping_list ?? []);
    return items.length > 0 ? items : null;
  } catch (aiError) {
    console.error("Shopping list AI parsing failed, using rules:", aiError);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ShoppingAssistantRequest;

    if (!body || (body.type !== "wishlist_input" && body.type !== "suggestions")) {
      return NextResponse.json({ error: "Invalid shopping assistant request" }, { status: 400 });
    }

    if (body.type === "wishlist_input" && (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_SHOPPING_TEXT)) {
      return NextResponse.json({ error: "Wishlist input text is required" }, { status: 400 });
    }

    if (body.type === "suggestions" && !body.day?.city) {
      return NextResponse.json({ error: "Suggestion context day.city is required" }, { status: 400 });
    }

    const response = runShoppingAssistant(body);
    if (body.type === "wishlist_input") {
      const aiItems = await parseWithAi(request, body);
      response.source = aiItems ? "ai" : "rules";
      if (aiItems) response.wishlist_items = aiItems;
    }
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown shopping assistant error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
