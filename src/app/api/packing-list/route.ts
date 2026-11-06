import { NextResponse } from "next/server";
import { runAiPrompt } from "@/lib/ai/provider";
import { extractJsonObject } from "@/lib/ai/json-response";
import { enforceAiQuota } from "@/lib/ai/quota";
import { getAuthClient } from "@/lib/supabase-server";
import {
  buildPackingSystemPrompt,
  buildPackingUserPrompt,
  type PackingPromptInput,
} from "@/lib/packing-assistant";
import type { PackingCategory } from "@/lib/types";

type AiPackingResponse = {
  categories: Array<{
    name: string;
    items: Array<{ name: string; quantity: number; reason: string }>;
  }>;
};

export async function POST(request: Request) {
  // Spends AI credits: registered users only (not anonymous guests).
  const supabase = getAuthClient(request);
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user || authData.user.is_anonymous) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const input = (await request.json()) as PackingPromptInput;

    const blocked = await enforceAiQuota(supabase, "packing");
    if (blocked) return blocked;

    const systemPrompt = buildPackingSystemPrompt(input.lang || "en");
    const userPrompt = buildPackingUserPrompt(input);
    const raw = await runAiPrompt(systemPrompt, userPrompt, { tier: "fast" });

    const parsed = extractJsonObject<AiPackingResponse>(raw);
    if (!parsed?.categories?.length) {
      return NextResponse.json(
        { error: "AI returned an invalid packing list" },
        { status: 502 },
      );
    }

    // Normalize into typed categories with IDs
    let itemIndex = 0;
    const categories: PackingCategory[] = parsed.categories.map((cat) => ({
      name: cat.name,
      items: cat.items.map((item) => ({
        id: `packing-${++itemIndex}`,
        name: item.name,
        quantity: item.quantity || 1,
        reason: item.reason || "",
        status: "pending" as const,
      })),
    }));

    return NextResponse.json({ categories });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown packing error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
