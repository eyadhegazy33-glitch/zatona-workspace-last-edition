import { getSupabaseClient } from "../lib/supabase";

export type LiveTimer = {
  checkin_id: number;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  is_inside: boolean;
  resource_name: string | null;
  checked_in_at: string;
  deadline: string;
  warning_at: string;
  overdue_at: string;
  state: "ok" | "warning" | "overdue";
  seconds_left: number;
  fees_due: number;
  server_now: string;
};

function isValidTimer(value: unknown): value is LiveTimer {
  if (!value || typeof value !== "object") return false;
  const timer = value as Record<string, unknown>;
  return (
    typeof timer.checkin_id === "number" &&
    typeof timer.customer_id === "string" &&
    typeof timer.customer_name === "string" &&
    typeof timer.customer_code === "string" &&
    typeof timer.is_inside === "boolean" &&
    (typeof timer.resource_name === "string" || timer.resource_name === null) &&
    typeof timer.checked_in_at === "string" &&
    typeof timer.deadline === "string" &&
    typeof timer.warning_at === "string" &&
    typeof timer.overdue_at === "string" &&
    (timer.state === "ok" || timer.state === "warning" || timer.state === "overdue") &&
    typeof timer.seconds_left === "number" &&
    typeof timer.fees_due === "number" &&
    typeof timer.server_now === "string"
  );
}

export async function getLiveTimers(): Promise<LiveTimer[]> {
  const { data, error } = await getSupabaseClient().rpc("get_live_timers");
  if (error) throw error;
  if (!Array.isArray(data) || !data.every(isValidTimer)) {
    throw new Error("Live timer response was invalid.");
  }
  return data;
}

export async function checkOutVisit(
  checkinId: number,
): Promise<{ customer_id: string; fees_due: number }> {
  const { data, error } = await getSupabaseClient().rpc("check_out", {
    p_checkin: checkinId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Check-out response was invalid.");
  }
  const result = data as Record<string, unknown>;
  const feesDue = Number(result.fees_due);
  if (typeof result.customer_id !== "string" || !Number.isFinite(feesDue)) {
    throw new Error("Check-out response was invalid.");
  }
  return { customer_id: result.customer_id, fees_due: feesDue };
}
