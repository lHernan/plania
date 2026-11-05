import type { Metadata } from "next";
import { Suspense } from "react";
import { Planner } from "@/components/planner/Planner";

export const metadata: Metadata = {
  title: "Planifica tu viaje · Tachao",
  description: "Destino, fechas o número de días y tu estilo: un primer itinerario día a día.",
};

/** /plan — the planner. It reads the landing's query, so it renders on the client under Suspense. */
export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <Planner />
    </Suspense>
  );
}
