import { TripPlan, TripDay, Activity } from "@/lib/types";

export type TripTemplate = {
  id: string;
  name: string;
  description: string;
  coverEmoji: string;
  durationDays: number;
  plan: TripPlan;
};

const makeId = (prefix: string, n: number) => `${prefix}-${n}`;

function buildDays(
  tripId: string,
  entries: Array<{ date: string; city: string; label: string; acts: Array<Partial<Activity> & { title: string; time: string }> }>
): TripDay[] {
  return entries.map((d, i) => ({
    id: `day-${i + 1}`,
    date: d.date,
    city: d.city,
    label: d.label,
    userId: "",
    activities: d.acts.map((a, j) => ({
      id: `act-${i + 1}-${j + 1}`,
      dayId: `day-${i + 1}`,
      tripId,
      userId: "",
      city: d.city,
      title: a.title,
      time: a.time,
      durationMin: a.durationMin ?? 60,
      notes: a.notes,
      location: a.location,
      category: (a.category as Activity["category"]) ?? "sightseeing",
      priority: a.priority ?? "medium",
      state: "pending",
      sort_order: j,
      files: [],
    })),
  }));
}

const seoulPlan: TripPlan = {
  id: "tpl-madrid-seoul",
  name: "Madrid → Seúl: experiencia hanok",
  userId: null,
  startDate: "2026-05-02",
  endDate: "2026-05-06",
  createdAt: new Date().toISOString(),
  isFavorite: false,
  days: buildDays("tpl-madrid-seoul", [
    {
      date: "2026-05-02",
      city: "Madrid",
      label: "Vuelo a Seúl",
      acts: [
        { title: "Vuelo Madrid → Seúl (Barajas T1)", time: "13:10", durationMin: 720, category: "transport", priority: "critical", location: "Madrid Barajas T1", notes: "Salida 13:10. Noche en vuelo." },
      ],
    },
    {
      date: "2026-05-03",
      city: "Seúl",
      label: "Llegada y hanok",
      acts: [
        { title: "Llegada a Gimpo (GMP)", time: "13:05", durationMin: 60, category: "transport", priority: "critical", location: "Gimpo Airport", notes: "Inmigración + maletas. Sacar efectivo / eSIM." },
        { title: "Traslado + check-in hanok", time: "14:15", durationMin: 75, category: "hotel", priority: "high", location: "Hanok Gongsimga", notes: "Check-in parte de la experiencia. Fotos, ducha rápida." },
        { title: "Paseo por Bukchon", time: "16:00", durationMin: 120, category: "sightseeing", priority: "medium", location: "Bukchon Hanok Village" },
      ],
    },
    {
      date: "2026-05-04",
      city: "Seúl",
      label: "Palacios y mercados",
      acts: [
        { title: "Gyeongbokgung", time: "09:30", durationMin: 120, category: "sightseeing", priority: "high", location: "Gyeongbokgung Palace" },
        { title: "Almuerzo en Gwangjang Market", time: "12:30", durationMin: 90, category: "food", priority: "medium", location: "Gwangjang Market" },
        { title: "Dongdaemun Design Plaza", time: "15:00", durationMin: 90, category: "sightseeing", priority: "low", location: "DDP" },
      ],
    },
  ]),
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
};

const parisPlan: TripPlan = {
  id: "tpl-paris-escapade",
  name: "París en 3 días",
  userId: null,
  startDate: "2026-06-10",
  endDate: "2026-06-12",
  createdAt: new Date().toISOString(),
  isFavorite: false,
  days: buildDays("tpl-paris-escapade", [
    {
      date: "2026-06-10",
      city: "París",
      label: "Llegada y Torre Eiffel",
      acts: [
        { title: "Check-in hotel (Le Marais)", time: "14:00", durationMin: 60, category: "hotel", priority: "high" },
        { title: "Torre Eiffel", time: "17:00", durationMin: 120, category: "sightseeing", priority: "critical", location: "Champ de Mars" },
        { title: "Cena en bistró", time: "20:00", durationMin: 90, category: "food", priority: "medium" },
      ],
    },
    {
      date: "2026-06-11",
      city: "París",
      label: "Louvre y Montmartre",
      acts: [
        { title: "Museo del Louvre", time: "09:30", durationMin: 180, category: "sightseeing", priority: "high", location: "Louvre" },
        { title: "Almuerzo en Le Marais", time: "13:00", durationMin: 75, category: "food", priority: "medium" },
        { title: "Montmartre y Sacré-Cœur", time: "16:00", durationMin: 120, category: "sightseeing", priority: "medium" },
      ],
    },
    {
      date: "2026-06-12",
      city: "París",
      label: "Versalles y despedida",
      acts: [
        { title: "Palacio de Versalles", time: "09:00", durationMin: 240, category: "sightseeing", priority: "high", location: "Versailles" },
        { title: "Vuelo de regreso", time: "19:00", durationMin: 180, category: "transport", priority: "critical" },
      ],
    },
  ]),
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
};

const tokyoPlan: TripPlan = {
  id: "tpl-tokyo-semana",
  name: "Tokio en 5 días",
  userId: null,
  startDate: "2026-09-01",
  endDate: "2026-09-05",
  createdAt: new Date().toISOString(),
  isFavorite: false,
  days: buildDays("tpl-tokyo-semana", [
    {
      date: "2026-09-01",
      city: "Tokio",
      label: "Llegada a Shibuya",
      acts: [
        { title: "Check-in hotel Shibuya", time: "15:00", durationMin: 60, category: "hotel", priority: "high" },
        { title: "Cruce de Shibuya", time: "18:00", durationMin: 45, category: "sightseeing", priority: "medium", location: "Shibuya Crossing" },
        { title: "Cena en izakaya", time: "20:00", durationMin: 90, category: "food", priority: "medium" },
      ],
    },
    {
      date: "2026-09-02",
      city: "Tokio",
      label: "Asakusa y Akihabara",
      acts: [
        { title: "Senso-ji", time: "09:00", durationMin: 90, category: "sightseeing", priority: "high", location: "Asakusa" },
        { title: "Almuerzo ramen", time: "12:30", durationMin: 60, category: "food", priority: "medium" },
        { title: "Akihabara", time: "15:00", durationMin: 120, category: "shopping", priority: "low", location: "Akihabara" },
      ],
    },
    {
      date: "2026-09-03",
      city: "Tokio",
      label: "Harajuku y Shinjuku",
      acts: [
        { title: "Meiji Jingu", time: "09:30", durationMin: 90, category: "sightseeing", priority: "medium", location: "Harajuku" },
        { title: "Takeshita Street", time: "11:30", durationMin: 60, category: "shopping", priority: "low" },
        { title: "Mirador de Shinjuku", time: "18:00", durationMin: 90, category: "sightseeing", priority: "medium", location: "Tokyo Metropolitan Government Building" },
      ],
    },
  ]),
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
};

export const TRIP_TEMPLATES: TripTemplate[] = [
  {
    id: seoulPlan.id,
    name: seoulPlan.name,
    description: "5 días entre Madrid y Seúl: vuelo, hanok, palacios y mercados.",
    coverEmoji: "🇰🇷",
    durationDays: seoulPlan.days.length,
    plan: seoulPlan,
  },
  {
    id: parisPlan.id,
    name: parisPlan.name,
    description: "3 días en París: Torre Eiffel, Louvre, Montmartre y Versalles.",
    coverEmoji: "🇫🇷",
    durationDays: parisPlan.days.length,
    plan: parisPlan,
  },
  {
    id: tokyoPlan.id,
    name: tokyoPlan.name,
    description: "5 días en Tokio: Shibuya, Asakusa, Harajuku y Shinjuku.",
    coverEmoji: "🇯🇵",
    durationDays: tokyoPlan.days.length,
    plan: tokyoPlan,
  },
];
