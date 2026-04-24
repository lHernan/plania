import { Activity } from "@/lib/types";
import { geminiService } from "./gemini-service";

export const dayGeniusService = {
  async optimizeDay(date: string, activities: Activity[]): Promise<Activity[]> {
    const normalized = await this.normalizeActivities(activities);
    const enriched = await this.enrichActivities(normalized);
    const routed = this.optimizeRoute(enriched);
    return routed;
  },

  async normalizeActivities(activities: Activity[]): Promise<Activity[]> {
    // 1. Extract unique locations
    const locations = Array.from(new Set(activities.map(a => a.location).filter(Boolean))) as string[];
    
    // 2. Group them semantically
    const groups = await geminiService.compareLocations(locations);
    
    // Create a map from original location to primary location
    const locationMap = new Map<string, string>();
    for (const group of groups) {
      if (group.length > 0) {
        const primary = group[0];
        for (const loc of group) {
          locationMap.set(loc, primary);
        }
      }
    }

    // 3. Merge activities
    const merged: Activity[] = [];
    const groupedByLocation = new Map<string, Activity[]>();

    for (const a of activities) {
      const loc = a.location ? (locationMap.get(a.location) || a.location) : a.location;
      // Merge all activities at the same location. If no location, group by title to avoid merging unrelated things.
      const key = loc ? `loc-${loc}` : `no-loc-${a.title.toLowerCase().trim()}`;
      if (!groupedByLocation.has(key)) {
        groupedByLocation.set(key, []);
      }
      groupedByLocation.get(key)!.push({ ...a, location: loc });
    }

    for (const group of groupedByLocation.values()) {
      if (group.length === 1) {
        merged.push(group[0]);
      } else {
        // Merge them
        // Keep the earliest time, sum the durations, combine notes
        group.sort((a, b) => a.time.localeCompare(b.time));
        const primary = group[0];
        
        const totalDuration = group.reduce((sum, a) => sum + (a.durationMin || 0), 0);
        const combinedNotes = group.map(a => `• ${a.title} (${a.time}): ${a.notes || ""}`).filter(Boolean).join("\n");

        merged.push({
          ...primary,
          title: `${primary.title} & more`,
          durationMin: totalDuration,
          notes: (primary.notes ? primary.notes + "\n\nMerged Subtasks:\n" : "Merged Subtasks:\n") + combinedNotes
        });
      }
    }

    return merged;
  },

  async enrichActivities(activities: Activity[]): Promise<Activity[]> {
    let enriched = [...activities];

    // Rule-based: Airport
    const hasAirport = enriched.some(a => 
      a.location?.toLowerCase().includes("airport") || 
      a.title.toLowerCase().includes("flight") ||
      (a.category === "transport" && a.title.toLowerCase().includes("airport"))
    );

    const hasTransportToAirport = enriched.some(a => 
      a.title.toLowerCase().includes("go to airport") || 
      a.title.toLowerCase().includes("travel to airport")
    );

    if (hasAirport && !hasTransportToAirport) {
      const airportActivity = enriched.find(a => 
        a.location?.toLowerCase().includes("airport") || 
        a.title.toLowerCase().includes("flight") ||
        (a.category === "transport" && a.title.toLowerCase().includes("airport"))
      );

      if (airportActivity) {
        // Find time 2 hours before
        const [hours, minutes] = airportActivity.time.split(":").map(Number);
        let newHours = hours - 2;
        if (newHours < 0) newHours = 0;
        const newTime = `${String(newHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

        enriched.push({
          id: `inferred-airport-${Date.now()}`,
          dayId: airportActivity.dayId,
          city: airportActivity.city,
          title: "Go to Airport",
          time: newTime,
          durationMin: 60,
          category: "transport",
          priority: "high",
          state: "pending",
          sort_order: 0,
          notes: "Inferred step: Leave early to have enough time for check-in and security."
        });
      }
    }

    // Call Gemini to suggest missing steps
    const suggestions = await geminiService.inferMissingSteps(enriched);
    
    // Add suggestions as new items
    if (suggestions.length > 0) {
       for (let i = 0; i < suggestions.length; i++) {
         const s = suggestions[i];
         enriched.push({
          id: `inferred-gemini-${Date.now()}-${i}`,
          dayId: enriched[0]?.dayId || "",
          city: enriched[0]?.city || "Unassigned",
          title: s.title,
          time: "12:00", // Default time, to be sorted manually or by time if we had logic
          durationMin: 30,
          category: (s.category || "other") as any,
          priority: "medium",
          state: "pending",
          sort_order: 0,
          notes: "AI Suggestion: " + s.notes
        });
       }
    }

    return enriched;
  },

  optimizeRoute(activities: Activity[]): Activity[] {
    // Basic routing:
    // For MVP, we will sort them by time.
    let sorted = [...activities].sort((a, b) => a.time.localeCompare(b.time));

    // Update sort_order
    sorted = sorted.map((a, i) => ({ ...a, sort_order: i }));

    return sorted;
  }
};
