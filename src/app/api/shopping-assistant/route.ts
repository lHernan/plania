import { NextResponse } from "next/server";
import { runShoppingAssistant } from "@/lib/shopping-assistant";
import type { ShoppingAssistantRequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ShoppingAssistantRequest;

    if (!body || (body.type !== "wishlist_input" && body.type !== "suggestions")) {
      return NextResponse.json({ error: "Invalid shopping assistant request" }, { status: 400 });
    }

    if (body.type === "wishlist_input" && !body.text?.trim()) {
      return NextResponse.json({ error: "Wishlist input text is required" }, { status: 400 });
    }

    if (body.type === "suggestions" && !body.day?.city) {
      return NextResponse.json({ error: "Suggestion context day.city is required" }, { status: 400 });
    }

    return NextResponse.json(runShoppingAssistant(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown shopping assistant error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
