import { TripRouteSync } from "@/components/TripRouteSync";
import { TripView } from "@/components/TripView";

/**
 * One TripView for every section of a trip: a layout is not re-rendered when moving between
 * its pages, so the selected day, open sheets and the map keep their state. TripView shows
 * the section from the path; the section pages themselves render nothing.
 */
export default function TripLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TripRouteSync />
      <TripView />
      {children}
    </>
  );
}
