import type { Activity, BookingType } from "@/lib/types";
import type { ExtractedBooking } from "./extract";

export type BookingDuplicate = {
  kind: "existing" | "batch";
  /** Existing activity id (kind "existing") or the first candidate id in the batch (kind "batch"). */
  matchId: string;
  reason: "reference" | "same_file" | "same_details";
};

type Comparable = {
  id: string;
  type: BookingType;
  reference?: string;
  provider?: string;
  startDate?: string;
  startTime?: string;
  from?: string;
  to?: string;
  sha256?: string;
};

function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, "");
}

function fromCandidate(b: ExtractedBooking): Comparable {
  return {
    id: b.id,
    type: b.type,
    reference: normalize(b.reference) || undefined,
    provider: normalize(b.provider) || undefined,
    startDate: b.start?.date,
    startTime: b.start?.time,
    from: normalize(b.from) || undefined,
    to: normalize(b.to) || undefined,
    sha256: b.source?.sha256,
  };
}

/**
 * One booking reference can cover several segments (outbound and return, connections): it is
 * the same booking only when the date and route, where both sides have them, also match.
 */
function sameSegment(a: Comparable, b: Comparable): boolean {
  const differs = (x?: string, y?: string) => Boolean(x && y && x !== y);
  return !differs(a.startDate, b.startDate) && !differs(a.from, b.from) && !differs(a.to, b.to);
}

function matchReason(a: Comparable, b: Comparable, compareFiles: boolean): BookingDuplicate["reason"] | null {
  if (a.type === b.type && a.reference && a.reference === b.reference && sameSegment(a, b)) return "reference";
  if (compareFiles && a.sha256 && a.sha256 === b.sha256) return "same_file";
  const comparableDetails = !(a.reference && b.reference);
  if (
    comparableDetails
    && a.type === b.type
    && a.provider && a.provider === b.provider
    && a.startDate && a.startDate === b.startDate
    && a.startTime && a.startTime === b.startTime
  ) {
    return "same_details";
  }
  return null;
}

/**
 * Flags candidates that duplicate an already-saved booking activity or an earlier candidate in the
 * same batch. Matches by reference (same segment), file hash (existing only) or type+provider+start;
 * never by file name.
 */
export function findBookingDuplicates(
  candidates: ExtractedBooking[],
  existing: Activity[],
): Record<string, BookingDuplicate> {
  const saved: Comparable[] = existing
    .filter((a) => a.booking)
    .map((a) => ({
      id: a.id,
      type: a.booking!.type,
      reference: normalize(a.booking!.reference) || undefined,
      provider: normalize(a.booking!.provider) || undefined,
      startDate: a.booking!.start?.date,
      startTime: a.booking!.start?.time,
      from: normalize(a.booking!.from) || undefined,
      to: normalize(a.booking!.to) || undefined,
      sha256: a.booking!.source?.sha256,
    }));

  const result: Record<string, BookingDuplicate> = {};
  const firstSeen: Comparable[] = [];

  for (const booking of candidates) {
    const current = fromCandidate(booking);

    let found: BookingDuplicate | null = null;
    for (const other of saved) {
      const reason = matchReason(current, other, true);
      if (reason) {
        found = { kind: "existing", matchId: other.id, reason };
        break;
      }
    }
    if (!found) {
      // Bookings from one file are naturally distinct (e.g. outbound + return), so no file match here.
      for (const other of firstSeen) {
        const reason = matchReason(current, other, false);
        if (reason) {
          found = { kind: "batch", matchId: other.id, reason };
          break;
        }
      }
    }

    if (found) result[booking.id] = found;
    else firstSeen.push(current);
  }

  return result;
}
