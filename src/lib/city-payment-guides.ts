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
export const CITY_PAYMENT_GUIDES: readonly CityPaymentGuide[] = [
  {
    city: "Madrid",
    country: "Spain",
    countryCode: "ES",
    facts: [
      {
        id: "es-madrid-public_transport-1",
        mode: "public_transport",
        question: "Can I tap a bank card to ride the Madrid Metro?",
        answer:
          "Yes. Since June 2026 all Metro turnstiles accept contactless Visa and Mastercard (physical cards, phones, and smartwatches). A smart-fare system automatically applies the cheapest rate.",
        sources: [
          {
            label: "Metro de Madrid — EMV contactless rules",
            url: "https://www.metromadrid.es/en/travel-in-the-metro/passenger-regulations/rules-for-the-use-of-emv-compliant-contactless-bank-cards",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "es-madrid-taxi-1",
        mode: "taxi",
        question: "Do Madrid taxis accept card payments?",
        answer:
          "Yes. Licensed Madrid taxis accept contactless and chip-and-PIN payments. You can also hail one through the FreeNow app for cashless payment.",
        sources: [
          {
            label: "Spain Guru — Taxi apps in Madrid",
            url: "https://spainguru.es/2025/01/13/taxi-apps-in-madrid-what-are-the-best-options-for-getting-around/",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "es-madrid-ride_hailing-1",
        mode: "ride_hailing",
        question: "Which ride-hailing apps work in Madrid?",
        answer:
          "Uber, Cabify, and Bolt all operate in Madrid. Cabify is the local incumbent with the widest coverage; Bolt is usually the cheapest option. All payments are handled in-app.",
        sources: [
          {
            label: "Bolt — Madrid",
            url: "https://bolt.eu/en/cities/madrid/",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
  {
    city: "Barcelona",
    country: "Spain",
    countryCode: "ES",
    facts: [
      {
        id: "es-barcelona-public_transport-1",
        mode: "public_transport",
        question: "Can I use contactless payment on Barcelona metro and buses?",
        answer:
          "Yes. TMB metro and buses accept contactless Visa, Mastercard, Amex, and mobile wallets directly at validators. You can also use a T-Mobilitat NFC card or the T-Mobilitat phone app for multi-ride passes at lower per-trip rates.",
        sources: [
          {
            label: "TMB — How T-Mobilitat works",
            url: "https://www.tmb.cat/en/fares-metro-bus-barcelona/t-mobilitat/how-it-works",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "es-barcelona-ride_hailing-1",
        mode: "ride_hailing",
        question: "Are Uber and Bolt available in Barcelona?",
        answer:
          "Uber, Cabify, and Bolt still operate as of October 2026, but Catalonia is advancing legislation to restrict ride-hailing (VTC) licenses. Check app availability closer to your trip date, as regulations may change.",
        sources: [
          {
            label: "Catalan News — Parliament taxi law 2026",
            url: "https://www.catalannews.com/politics/item/parliament-majority-expects-to-pass-new-taxi-law-in-2026",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
  {
    city: "Paris",
    country: "France",
    countryCode: "FR",
    facts: [
      {
        id: "fr-paris-public_transport-1",
        mode: "public_transport",
        question: "How do I pay for the Paris Metro and buses?",
        answer:
          "Buy a reusable Navigo Easy card at any station counter, then load single tickets or day passes at machines or via the Île-de-France Mobilités app. The Navigo Easy is contactless and cannot be demagnetised like old paper tickets.",
        sources: [
          {
            label: "Île-de-France Mobilités — Ticket supports",
            url: "https://www.iledefrance-mobilites.fr/en/titres-et-tarifs/supports",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "fr-paris-taxi-1",
        mode: "taxi",
        question: "Do Paris taxis accept credit cards?",
        answer:
          "Yes — by French law every licensed taxi must carry a working card terminal and cannot refuse card payment. Contactless and chip-and-PIN are accepted with no surcharge.",
        sources: [
          {
            label: "The Local France — Paris taxi rules",
            url: "https://www.thelocal.fr/20191209/what-you-need-to-know-about-taking-a-taxi-in-paris",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "fr-paris-ride_hailing-1",
        mode: "ride_hailing",
        question: "Which ride-hailing apps work in Paris?",
        answer:
          "Uber and Bolt are widely available. All payments are handled in-app (Visa, Mastercard, Amex). Uber also lets you book a licensed Paris taxi at a guaranteed upfront fare.",
        sources: [
          {
            label: "Bolt — Paris",
            url: "https://bolt.eu/en/cities/paris/",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
  {
    city: "Vienna",
    aliases: ["Wien"],
    country: "Austria",
    countryCode: "AT",
    facts: [
      {
        id: "at-vienna-public_transport-1",
        mode: "public_transport",
        question: "Can I tap a bank card on Vienna public transport?",
        answer:
          "Yes. Wiener Linien launched Tap+Ride in May 2026 — tap a contactless bank card, phone, or smartwatch at validators to buy a single ticket instantly. The WienMobil app also sells tickets digitally.",
        sources: [
          {
            label: "Wiener Linien — Tap+Ride",
            url: "https://www.wienerlinien.at/web/wl-en/tapandride",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "at-vienna-ride_hailing-1",
        mode: "ride_hailing",
        question: "Which ride-hailing apps work in Vienna?",
        answer:
          "Uber, Bolt, and FreeNow all operate in Vienna. Payments are handled in-app. FreeNow connects you with licensed taxi drivers.",
        sources: [
          {
            label: "Bolt — Vienna",
            url: "https://bolt.eu/en/cities/vienna/",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
  {
    city: "Budapest",
    country: "Hungary",
    countryCode: "HU",
    facts: [
      {
        id: "hu-budapest-public_transport-1",
        mode: "public_transport",
        question: "Can I use a bank card on the Budapest metro?",
        answer:
          "Yes. BKK's Pay&GO system lets you buy and validate a single ticket by tapping a contactless bank card on all metro lines (M1–M4) and the 100E airport bus. The BudapestGO app also sells mobile tickets.",
        sources: [
          {
            label: "BKK — Pay&GO contactless launch",
            url: "https://bkk.hu/en/news/2026/04/buy-and-validate-your-single-ticket-with-a-single-tap.16407/",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "hu-budapest-ride_hailing-1",
        mode: "ride_hailing",
        question: "Which ride-hailing apps work in Budapest?",
        answer:
          "Bolt is the dominant ride-hailing app with the widest coverage and usually the lowest fares. FreeNow connects to licensed yellow taxis. Uber has limited availability.",
        sources: [
          {
            label: "Bolt — Budapest",
            url: "https://bolt.eu/en/cities/budapest/",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
  {
    city: "Prague",
    aliases: ["Praha"],
    country: "Czech Republic",
    countryCode: "CZ",
    facts: [
      {
        id: "cz-prague-public_transport-1",
        mode: "public_transport",
        question: "What is the cheapest way to buy a Prague transit ticket?",
        answer:
          "The PID Lítačka app offers the lowest fares (30-min ticket for 36 CZK vs 39 CZK on paper). Tickets are also sold at yellow vending machines and DPP counters. Contactless bank card payment is available at machines.",
        sources: [
          {
            label: "PID — Lítačka mobile app",
            url: "https://pid.cz/en/travel-information/pid-mobile-app/",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "cz-prague-ride_hailing-1",
        mode: "ride_hailing",
        question: "Should I use a taxi app or hail a cab in Prague?",
        answer:
          "Always use an app. Bolt and Uber show the fare upfront and handle payment in-app. Street-hailed taxis near tourist areas (Old Town Square, Wenceslas Square, Charles Bridge) frequently overcharge — a Bolt ride from the airport costs roughly 300–450 CZK versus 1 000+ CZK from unlicensed cabs.",
        sources: [
          {
            label: "PragueGo — Taxis, apps and how to avoid scams",
            url: "https://www.praguego.com/transport/taxi",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
  {
    city: "Tenerife",
    aliases: ["Santa Cruz de Tenerife"],
    country: "Spain",
    countryCode: "ES",
    facts: [
      {
        id: "es-tenerife-public_transport-1",
        mode: "public_transport",
        question: "Can I pay by card on TITSA buses in Tenerife?",
        answer:
          "Yes. All TITSA bus lines accept contactless Visa and Mastercard (no PIN required). For discounted fares, use a Ten+ card loaded with credit. The Ten+ Móvil app also works via QR code validation.",
        sources: [
          {
            label: "TITSA — Bank card payment",
            url: "https://www.titsa.com/index.php/en/your-buses/news/2397-payment-with-bank-card-payment-with-bank-card",
            checkedAt: "2026-10-22",
          },
        ],
      },
      {
        id: "es-tenerife-taxi-1",
        mode: "taxi",
        question: "Do Tenerife taxis take cards?",
        answer:
          "Most taxis accept Visa, Mastercard, and Amex, but card terminals are not guaranteed in smaller towns. Confirm with the driver before boarding. Cash is still common; carry small bills as backup.",
        sources: [
          {
            label: "Canarias Across — Tenerife taxi card payments",
            url: "https://canariasacross.com/islands/tenerife/are-tenerife-taxis-equipped-to-accept-card-payments",
            checkedAt: "2026-10-22",
          },
        ],
      },
    ],
  },
];

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
