import { BedDouble, Bus, Car, CarTaxiFront, Plane, Ship, Ticket, TrainFront, FileText, type LucideIcon } from "lucide-react";
import type { BookingField, BookingType } from "@/lib/types";

type T = (key: string, variables?: Record<string, string | number>) => string;

export const BOOKING_TYPE_ICONS: Record<BookingType, LucideIcon> = {
  flight: Plane,
  lodging: BedDouble,
  car_rental: Car,
  train: TrainFront,
  ferry: Ship,
  bus: Bus,
  transfer: CarTaxiFront,
  ticket: Ticket,
  other: FileText,
};

export function bookingTypeLabel(t: T, type: BookingType): string {
  return t(`booking_import_type_${type}`);
}

export function fieldLabel(t: T, field: BookingField | string): string {
  const key = `booking_import_field_${field}`;
  const text = t(key);
  return text === key ? field : text;
}

/** Translates the machine warning codes returned by the extraction route. */
export function warningLabel(t: T, code: string): string {
  if (code.startsWith("missing:")) return t("booking_import_warning_missing", { field: fieldLabel(t, code.slice(8)) });
  if (code.startsWith("invalid:")) return t("booking_import_warning_invalid", { field: fieldLabel(t, code.slice(8)) });
  switch (code) {
    case "unknown_type":
      return t("booking_import_warning_unknown_type");
    case "end_before_start":
      return t("booking_import_warning_end_before_start");
    case "unparseable_response":
      return t("booking_import_warning_unparseable_response");
    case "text_truncated":
      return t("booking_import_warning_text_truncated");
    default:
      return t("booking_import_warning_other", { code });
  }
}

export type FileErrorCode = "invalid" | "encrypted" | "too_large" | "no_text" | "extraction_failed" | "network" | "unauthorized";

export function fileErrorLabel(t: T, code: FileErrorCode): string {
  return t(`booking_import_error_${code}`);
}
