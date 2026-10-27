import type { ShoppingCategory, ShoppingItem } from "@/lib/types";

/**
 * Kinds of shop an item can be bought in, as Geoapify place categories
 * (https://apidocs.geoapify.com/docs/places/). Only these keys are accepted from the AI
 * and sent to the nearby search.
 */
export const SHOP_KINDS = [
  "commercial.supermarket",
  "commercial.convenience",
  "commercial.marketplace",
  "commercial.food_and_drink",
  "commercial.food_and_drink.bakery",
  "commercial.food_and_drink.cheese_and_dairy",
  "commercial.food_and_drink.chocolate",
  "commercial.food_and_drink.coffee_and_tea",
  "commercial.food_and_drink.confectionery",
  "commercial.food_and_drink.deli",
  "commercial.food_and_drink.drinks",
  "commercial.food_and_drink.spices",
  "commercial.gift_and_souvenir",
  "commercial.clothing",
  "commercial.clothing.shoes",
  "commercial.clothing.accessories",
  "commercial.bag",
  "commercial.jewelry",
  "commercial.watches",
  "commercial.health_and_beauty",
  "commercial.health_and_beauty.cosmetics",
  "commercial.health_and_beauty.pharmacy",
  "commercial.chemist",
  "commercial.houseware_and_hardware",
  "commercial.furniture_and_interior",
  "commercial.florist",
  "commercial.garden",
  "commercial.elektronics",
  "commercial.books",
  "commercial.stationery",
  "commercial.toy_and_game",
  "commercial.baby_goods",
  "commercial.outdoor_and_sport",
  "commercial.art",
  "commercial.antiques",
  "commercial.hobby",
  "commercial.pet",
  "commercial.department_store",
  "commercial.shopping_mall",
] as const;

export type ShopKind = (typeof SHOP_KINDS)[number];

const KNOWN = new Set<string>(SHOP_KINDS);

export const isShopKind = (value: unknown): value is ShopKind => typeof value === "string" && KNOWN.has(value);

/** Used when an item has no kinds of its own (rule-based parsing or older items). */
const DEFAULT_KINDS: Record<ShoppingCategory, ShopKind[]> = {
  food: ["commercial.supermarket", "commercial.food_and_drink", "commercial.marketplace"],
  souvenir: ["commercial.gift_and_souvenir", "commercial.marketplace"],
  fashion: ["commercial.clothing", "commercial.shopping_mall", "commercial.department_store"],
  beauty: ["commercial.health_and_beauty", "commercial.chemist"],
  home: ["commercial.houseware_and_hardware", "commercial.furniture_and_interior", "commercial.gift_and_souvenir"],
  electronics: ["commercial.elektronics", "commercial.shopping_mall"],
  other: ["commercial.gift_and_souvenir", "commercial.department_store", "commercial.shopping_mall", "commercial.marketplace"],
};

export function shopKindsFor(item: Pick<ShoppingItem, "category" | "shopCategories">): ShopKind[] {
  const own = (item.shopCategories ?? []).filter(isShopKind);
  return own.length > 0 ? own : DEFAULT_KINDS[item.category] ?? DEFAULT_KINDS.other;
}

/** A place sells for a kind when it has that category or a more specific one under it. */
export function placeMatchesKinds(placeCategories: string[], kinds: string[]): boolean {
  return kinds.some((kind) => placeCategories.some((category) => category === kind || category.startsWith(`${kind}.`)));
}
