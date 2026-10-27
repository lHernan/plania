# Plania - Premium Mobile-First Travel Itinerary

Plania is a premium itinerary web app for complex international travel with many cities, bookings, and strict schedules.

## Tech Stack

- Next.js 15+ App Router (project currently on Next 16, fully Vercel-compatible)
- TypeScript
- Tailwind CSS
- shadcn-style UI primitives (`src/components/ui`)
- Framer Motion
- Zustand with localStorage persistence
- dnd-kit drag/drop
- PWA manifest + service worker

## Delivered Features

- Horizontal day slider with day pills, swipe gesture, desktop arrows, and "Today" jump.
- Vertical hourly timeline with card UI, drag-drop reordering, duplicate/move/convert actions.
- Completion controls: checkbox, swipe-complete, long-press delayed, skipped state, progress bars.
- Sticky Critical Reservations panel with urgency indicators and checklist status.
- AI optimizer module with "Optimize my day" suggestions for overlaps and route timing.
- Fast-add floating action button with 5-second activity capture flow.
- AI import parser for free-text itinerary notes.
- Smart travel widgets: next activity, countdown, budget/day placeholder modules.
- Offline-safe local persistence and service worker caching.

## Project Structure

```text
src/
  app/
    globals.css
    layout.tsx
    page.tsx
  components/
    pwa-register.tsx
    ui/
      button.tsx
      card.tsx
  lib/
    ai/
      optimizer.ts
    import/
      parse-itinerary.ts
    mock-data.ts
    types.ts
    utils.ts
  store/
    use-itinerary-store.ts
public/
  manifest.webmanifest
  sw.js
  icon.svg
```

## AI Assistant Module Architecture

- `src/lib/ai/optimizer.ts`
  - Input: `TripDay` activities (time, duration, category, status, priority).
  - Rules: detect overlaps, detect tight transfer windows, identify booking urgency and photo timing hints.
  - Output: normalized `OptimizationSuggestion[]` for rendering in the UI.
- Future-ready extension points:
  - OpenAI/LLM route optimization
  - Google Maps travel time matrix integration
  - Weather-aware schedule fallback suggestions

## Import Parser

- `src/lib/import/parse-itinerary.ts`
- Parses raw lines like:
  - `May 10 07:30 taxi hotel`
  - `09:30 tea ceremony`
  - `14:00 kimono photos`
- Extracts time + title and classifies category heuristically (`transport`, `hotel`, `reservation`, `food`, `photos`, `sightseeing`).

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import the repo into [Vercel](https://vercel.com/new).
3. Framework preset: `Next.js`.
4. Build command: `npm run build` (default).
5. Output directory: default (`.next`).
6. Deploy.

## AI models

AI calls go to an OpenAI-compatible chat completions endpoint:

- `AI_API_URL`, `AI_API_KEY`, `AI_MODEL`: primary provider. `AI_MODEL` is a comma-separated list tried in order; the next model is tried only after a network error, 408, 429 or 5xx (any other 4xx, such as an unknown model, stops the list).
- `AI_FALLBACK_API_URL`, `AI_FALLBACK_API_KEY`, `AI_FALLBACK_MODEL`: optional second provider, used only when the primary ends with 429 or 5xx.
- `AI_MODEL_FAST`, `AI_FALLBACK_MODEL_FAST`: optional cheaper models for simple tasks (packing list, QR/barcode detection). When unset, those tasks use `AI_MODEL` / `AI_FALLBACK_MODEL`.

## Future Roadmap

- Supabase sync and auth
- Shared itinerary collaboration (family/group)
- Real-time updates and comments
- Reservation inbox integrations
- QR attachments and travel document vault
