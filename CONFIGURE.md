# Plania Configuration Guide

This guide explains how to configure and extend the Plania itinerary app.

## 1. Local State Persistence
Plania uses **Zustand** with the `persist` middleware to save your itinerary data in the browser's `localStorage`.
- **Store Path**: `src/store/use-itinerary-store.ts`
- **Storage Key**: `plania-itinerary-v1`
- **Clearing Data**: To reset the app, you can clear your browser's local storage or modify the `samplePlan` in the store.

## 2. Default Trip Data
The initial data you see is loaded from:
- **File**: `src/lib/mock-data.ts`
- You can modify this file to change the default trip name, days, cities, and activities. The app will automatically sync these changes unless you already have data in your local storage (in which case the stored data takes precedence).

## 3. Styling & Theme
The design system follows a premium glassmorphism aesthetic built on **Tailwind CSS**.
- **Global Styles**: `src/app/globals.css` defines the color palette, glassmorphism utilities (`.glass`), and premium card styles (`.premium-card`).
- **Accent Colors**: Search for `indigo-600` or `gradient-text` in `src/app/page.tsx` to change the primary brand colors.

## 4. AI Parsing & Optimization
- **Parser**: `src/lib/import/parse-itinerary.ts` handles the text-based import logic.
- **Optimizer**: `src/lib/ai/optimizer.ts` generates suggestions based on the current day's activities.
- **API Integration**: The weather and advanced AI optimization sections in `src/app/page.tsx` are currently placeholders. You can connect them to real APIs (like OpenWeather or OpenAI) by updating the respective hooks or service files.

## 5. Development
- **Run Dev Server**: `npm run dev`
- **Build for Production**: `npm run build`
- **Environment Variables**: Create a `.env.local` for any private API keys you might add later (e.g., `NEXT_PUBLIC_MAPS_API_KEY`).

## 6. TODO Logic
- **Checked Items**: Marked as `completed` state. They automatically move to the bottom of the daily list.
- **Unmarking**: Unchecking a box reverts the state to `pending`, and the item returns to its chronological position based on the `time` field.
- **Time Editing**: Click on the time label within any activity card to edit its schedule.
