import type { ShoppingItem } from "@/lib/types";

/**
 * Items are added at once with the rule-based split; the AI answer arrives later and
 * improves them. Anything the traveler touched meanwhile (renamed, checked, deleted) wins.
 */
export type RefinePlan = {
  updates: { id: string; patch: Partial<ShoppingItem> }[];
  removeIds: string[];
  additions: ShoppingItem[];
};

const untouched = (provisional: ShoppingItem, current: ShoppingItem[]) =>
  current.some((item) => item.id === provisional.id && item.name === provisional.name && item.status === provisional.status);

export function planRefinement(provisional: ShoppingItem[], current: ShoppingItem[], refined: ShoppingItem[]): RefinePlan {
  const plan: RefinePlan = { updates: [], removeIds: [], additions: [] };
  if (refined.length === 0) return plan;

  // Same split: improve each item in place, keeping its id.
  if (refined.length === provisional.length) {
    provisional.forEach((item, index) => {
      if (!untouched(item, current)) return;
      const better = refined[index];
      plan.updates.push({
        id: item.id,
        patch: { name: better.name, category: better.category, shopCategories: better.shopCategories },
      });
    });
    return plan;
  }

  // A different split (dictation without commas): swap the whole set, only if nobody touched it.
  if (provisional.every((item) => untouched(item, current))) {
    plan.removeIds = provisional.map((item) => item.id);
    plan.additions = refined;
  }
  return plan;
}
