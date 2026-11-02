import { z } from "zod";
import { getSupabaseClient } from "../lib/supabase";
import type { Database } from "../lib/database.types";

export type Alert = Database["public"]["Tables"]["alerts"]["Row"];
export type AlertSeverity = Alert["severity"];
export type AlertStatus = Alert["status"];
export type AlertTab = "active" | "snoozed" | "resolved";

export type AlertOverview = {
  active_count: number;
  low_count: number;
  medium_count: number;
  high_count: number;
  critical_count: number;
  critical_unacknowledged: boolean;
};

export type AlertStaff = {
  user_id: string;
  first_name: string;
  last_name: string;
  role_name: string | null;
};

const alertIdSchema = z.string().uuid();
const assignmentSchema = z.object({
  alertId: z.string().uuid(),
  userId: z.string().uuid(),
});
const snoozeSchema = z.object({
  alertId: z.string().uuid(),
  minutes: z.union([z.literal(15), z.literal(60), z.literal(240)]),
});

function requireData<T>(data: T | null): T {
  if (data === null) throw new Error("The alert request returned no data.");
  return data;
}

export async function getAlertOverview(): Promise<AlertOverview> {
  const { data, error } = await getSupabaseClient().rpc("get_alert_overview");
  if (error) throw error;
  const overview = requireData(data)[0];
  if (!overview) throw new Error("The alert overview returned no data.");
  return overview;
}

export async function listAlerts(tab: AlertTab): Promise<Alert[]> {
  const client = getSupabaseClient();
  let query = client.from("alerts").select("*").order("created_at", { ascending: false }).limit(1000);
  if (tab === "active") {
    query = query.in("status", ["open", "acknowledged"]);
  } else if (tab === "snoozed") {
    query = query.eq("status", "snoozed").gt("snoozed_until", new Date().toISOString());
  } else {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    query = query.eq("status", "resolved").gte("resolved_at", sevenDaysAgo.toISOString());
  }
  const { data, error } = await query;
  if (error) throw error;
  return requireData(data);
}

export async function getAlertStaff(): Promise<AlertStaff[]> {
  const { data, error } = await getSupabaseClient().rpc("get_alert_staff");
  if (error) throw error;
  return requireData(data);
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  const id = alertIdSchema.parse(alertId);
  const { error } = await getSupabaseClient().rpc("acknowledge_alert", { p_id: id });
  if (error) throw error;
}

export async function assignAlert(alertId: string, userId: string): Promise<void> {
  const assignment = assignmentSchema.parse({ alertId, userId });
  const { error } = await getSupabaseClient().rpc("assign_alert", {
    p_id: assignment.alertId,
    p_user: assignment.userId,
  });
  if (error) throw error;
}

export async function snoozeAlert(alertId: string, minutes: number): Promise<void> {
  const input = snoozeSchema.parse({ alertId, minutes });
  const { error } = await getSupabaseClient().rpc("snooze_alert", {
    p_id: input.alertId,
    p_minutes: input.minutes,
  });
  if (error) throw error;
}

export async function getAlertShiftSession(sessionId: string) {
  const id = alertIdSchema.parse(sessionId);
  const { data, error } = await getSupabaseClient().rpc("get_alert_shift_session", {
    p_session: id,
  });
  if (error) throw error;
  return requireData(data)[0] ?? null;
}

export async function getAlertScanLog(alertId: string) {
  const id = alertIdSchema.parse(alertId);
  const { data, error } = await getSupabaseClient().rpc("get_alert_scan_log", {
    p_alert: id,
  });
  if (error) throw error;
  return requireData(data);
}
