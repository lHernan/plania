export type PaymentGuideMode = "public_transport" | "taxi" | "ride_hailing";

export type PaymentGuideSource = {
  label: string;
  url: string;
  checkedAt: string;
};

export type PaymentGuideFact = {
  id: string;
  mode: PaymentGuideMode;
  question: string;
  answer: string;
  sources: PaymentGuideSource[];
};

export type CityPaymentGuide = {
  city: string;
  aliases?: string[];
  country: string;
  countryCode: string;
  facts: PaymentGuideFact[];
};

// Only add a city after its answers have been checked against official/provider sources.
export const CITY_PAYMENT_GUIDES: readonly CityPaymentGuide[] = [];

export function normalizeGuideCity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function hasVerifiedSources(guide: CityPaymentGuide) {
  return guide.facts.length > 0 && guide.facts.every((fact) =>
    fact.question.trim().length > 0 &&
    fact.answer.trim().length > 0 &&
    fact.sources.length > 0 &&
    fact.sources.every((source) => {
      try {
        return new URL(source.url).protocol === "https:" && Number.isFinite(Date.parse(source.checkedAt));
      } catch {
        return false;
      }
    })
  );
}

export function findCityPaymentGuide(city: string | undefined, guides: readonly CityPaymentGuide[] = CITY_PAYMENT_GUIDES) {
  if (!city?.trim()) return undefined;
  const key = normalizeGuideCity(city);
  return guides.find((guide) =>
    hasVerifiedSources(guide) &&
    [guide.city, ...(guide.aliases ?? [])].some((alias) => normalizeGuideCity(alias) === key)
  );
}
