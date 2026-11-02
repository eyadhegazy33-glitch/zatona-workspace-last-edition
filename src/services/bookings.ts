import { getSupabaseClient } from "../lib/supabase";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "no_show";

export type BookingResource = {
  id: string;
  type: "room" | "table" | "seat";
  name: string;
  capacity: number;
  status: "available" | "maintenance";
  occupied: boolean;
};

export type BookingSettings = {
  currencyCode: string;
  timeZone: string;
};

export type BookingCustomer = {
  id: string;
  first_name: string;
  last_name: string;
  code: string;
};

export type Booking = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  resource_id: string;
  resource_name: string;
  resource_type: string;
  resource_capacity: number;
  starts_at: string;
  ends_at: string;
  people: number;
  notes: string | null;
  deposit: number;
  status: BookingStatus;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type BookingInput = {
  customerId: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  people: number;
  notes: string;
  deposit: number;
};

function isBookingStatus(value: string): value is BookingStatus {
  return [
    "pending",
    "confirmed",
    "checked_in",
    "completed",
    "cancelled",
    "no_show",
  ].includes(value);
}

function isResourceType(value: string): value is BookingResource["type"] {
  return value === "room" || value === "table" || value === "seat";
}

export async function listBookings(input: {
  from: string;
  to: string;
  resourceId?: string | null;
  status?: BookingStatus | null;
  search?: string;
}): Promise<Booking[]> {
  const { data, error } = await getSupabaseClient().rpc("list_bookings", {
    p_from: input.from,
    p_to: input.to,
    p_resource: input.resourceId ?? null,
    p_status: input.status ?? null,
    p_search: input.search?.trim() || null,
  });
  if (error) throw error;
  return (data ?? []).map((booking) => {
    if (!isBookingStatus(booking.status)) {
      throw new Error("Booking returned an unsupported status.");
    }
    return { ...booking, status: booking.status };
  });
}

export async function listBookingResources(): Promise<BookingResource[]> {
  const { data, error } = await getSupabaseClient().rpc("get_booking_resources");
  if (error) throw error;
  return (data ?? []).map((resource) => {
    if (
      !isResourceType(resource.type) ||
      (resource.status !== "available" && resource.status !== "maintenance")
    ) {
      throw new Error("Booking resource returned an unsupported type or status.");
    }
    return {
      ...resource,
      type: resource.type,
      status: resource.status,
    };
  });
}

export async function getBookingSettings(): Promise<BookingSettings> {
  const { data, error } = await getSupabaseClient().rpc("get_booking_settings");
  if (error) throw error;
  const settings = data?.[0];
  if (!settings || !/^[A-Z]{3}$/.test(settings.currency_code)) {
    throw new Error("Booking display settings are unavailable or invalid.");
  }
  new Intl.DateTimeFormat("en", { timeZone: settings.time_zone });
  return {
    currencyCode: settings.currency_code,
    timeZone: settings.time_zone,
  };
}

export async function searchBookingCustomers(
  search: string,
): Promise<BookingCustomer[]> {
  if (search.trim().length < 2) return [];
  const { data, error } = await getSupabaseClient().rpc(
    "search_booking_customers",
    { p_search: search.trim() },
  );
  if (error) throw error;
  return data ?? [];
}

export async function createBooking(input: BookingInput): Promise<void> {
  const { error } = await getSupabaseClient().rpc("create_booking", {
    p_customer: input.customerId,
    p_resource: input.resourceId,
    p_starts: input.startsAt,
    p_ends: input.endsAt,
    p_people: input.people,
    p_notes: input.notes.trim() || null,
    p_deposit: input.deposit,
  });
  if (error) throw error;
}

export async function updateBooking(
  bookingId: string,
  input: BookingInput,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_booking", {
    p_id: bookingId,
    p_resource: input.resourceId,
    p_starts: input.startsAt,
    p_ends: input.endsAt,
    p_people: input.people,
    p_notes: input.notes.trim() || null,
    p_deposit: input.deposit,
  });
  if (error) throw error;
}

export async function setBookingStatus(
  bookingId: string,
  status: BookingStatus,
  reason?: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_booking_status", {
    p_id: bookingId,
    p_status: status,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
}

export async function checkInBooking(
  bookingId: string,
): Promise<{ id: number; checked_in_at: string }> {
  const { data, error } = await getSupabaseClient().rpc("booking_check_in", {
    p_booking: bookingId,
  });
  if (error) throw error;
  return { id: data.id, checked_in_at: data.checked_in_at };
}

export function getBookingErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message).toLowerCase();
  }
  return "";
}
