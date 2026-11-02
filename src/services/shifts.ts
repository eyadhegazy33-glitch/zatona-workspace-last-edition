import { getSupabaseClient } from "../lib/supabase";
import type { Json } from "../lib/database.types";

export type ScheduledShift = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  days: number[];
  active: boolean;
};

export type ShiftAssignment = {
  id: string;
  shift_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  work_date: string;
  user_id: string;
  user_name: string;
};

export type ShiftTeamMember = {
  id: string;
  name: string;
};

export type ShiftSwapRequest = {
  id: string;
  assignment_id: string;
  requester_id: string;
  requester_name: string;
  target_user_id: string;
  target_name: string;
  status: "pending";
  created_at: string;
  work_date: string;
  shift_name: string;
};

export type ShiftScheduleData = {
  shifts: ScheduledShift[];
  assignments: ShiftAssignment[];
  team: ShiftTeamMember[];
  swap_requests: ShiftSwapRequest[];
};

export type ShiftSession = {
  id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  note: string | null;
  created_at: string;
  shift_id: string | null;
  cash_expected: number | null;
  cash_counted: number | null;
  shift_name: string | null;
};

export type ShiftSummary = {
  session_id: string;
  shift_id: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  orders_count: number;
  unpaid_orders: number;
  receipts_by_method: Record<string, number>;
  cash_expected: number;
  cash_counted: number | null;
  cash_difference: number | null;
};

export type UnpaidShiftOrder = {
  order_id: string;
  order_number: number;
  total: number;
  created_at: string;
};

function isRecord(value: Json | null | undefined): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredJsonString(value: Json | undefined, field: string): string {
  if (typeof value !== "string") throw new Error(`Shift field ${field} was invalid.`);
  return value;
}

function requiredJsonNumber(value: Json | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Shift field ${field} was invalid.`);
  }
  return value;
}

function requiredString(value: Json | undefined, field: string): string {
  if (typeof value !== "string") throw new Error(`Shift field ${field} was invalid.`);
  return value;
}

function requiredBoolean(value: Json | undefined, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Shift field ${field} was invalid.`);
  return value;
}

function requiredNumber(value: Json | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Shift field ${field} was invalid.`);
  }
  return value;
}

function parseList<T>(value: Json | undefined, parser: (item: Json) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Shift response list was invalid.");
  return value.map(parser);
}

export async function getShiftScheduleData(
  from: string,
  to: string,
): Promise<ShiftScheduleData> {
  const { data, error } = await getSupabaseClient().rpc("get_shift_schedule_data", {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Shift schedule response was invalid.");

  const shifts = parseList(data.shifts, (item) => {
    if (!isRecord(item) || !Array.isArray(item.days)) {
      throw new Error("Scheduled shift response was invalid.");
    }
    return {
      id: requiredString(item.id, "id"),
      name: requiredString(item.name, "name"),
      start_time: requiredString(item.start_time, "start_time"),
      end_time: requiredString(item.end_time, "end_time"),
      days: item.days.map((day) => requiredNumber(day, "days")),
      active: requiredBoolean(item.active, "active"),
    };
  });
  const assignments = parseList(data.assignments, (item) => {
    if (!isRecord(item)) throw new Error("Shift assignment response was invalid.");
    return {
      id: requiredString(item.id, "assignment.id"),
      shift_id: requiredString(item.shift_id, "assignment.shift_id"),
      shift_name: requiredString(item.shift_name, "assignment.shift_name"),
      start_time: requiredString(item.start_time, "assignment.start_time"),
      end_time: requiredString(item.end_time, "assignment.end_time"),
      work_date: requiredString(item.work_date, "assignment.work_date"),
      user_id: requiredString(item.user_id, "assignment.user_id"),
      user_name: requiredString(item.user_name, "assignment.user_name"),
    };
  });
  const team = parseList(data.team, (item) => {
    if (!isRecord(item)) throw new Error("Shift team response was invalid.");
    return {
      id: requiredString(item.id, "team.id"),
      name: requiredString(item.name, "team.name"),
    };
  });
  const swap_requests = parseList(data.swap_requests, (item) => {
    if (!isRecord(item) || item.status !== "pending") {
      throw new Error("Shift swap request response was invalid.");
    }
    return {
      id: requiredString(item.id, "swap.id"),
      assignment_id: requiredString(item.assignment_id, "swap.assignment_id"),
      requester_id: requiredString(item.requester_id, "swap.requester_id"),
      requester_name: requiredString(item.requester_name, "swap.requester_name"),
      target_user_id: requiredString(item.target_user_id, "swap.target_user_id"),
      target_name: requiredString(item.target_name, "swap.target_name"),
      status: "pending" as const,
      created_at: requiredString(item.created_at, "swap.created_at"),
      work_date: requiredString(item.work_date, "swap.work_date"),
      shift_name: requiredString(item.shift_name, "swap.shift_name"),
    };
  });

  return { shifts, assignments, team, swap_requests };
}

export async function saveScheduledShift(input: {
  id: string | null;
  name: string;
  startTime: string;
  endTime: string;
  days: number[];
  active: boolean;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("save_scheduled_shift", {
    p_id: input.id,
    p_name: input.name,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_days: input.days,
    p_active: input.active,
  });
  if (error) throw error;
}

export async function assignScheduledShift(input: {
  shiftId: string;
  userId: string;
  workDate: string;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("assign_scheduled_shift", {
    p_shift: input.shiftId,
    p_user: input.userId,
    p_work_date: input.workDate,
  });
  if (error) throw error;
}

export async function removeScheduledShiftAssignment(assignmentId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("remove_scheduled_shift_assignment", {
    p_assignment: assignmentId,
  });
  if (error) throw error;
}

export async function getShiftStaff(activeOnly = true): Promise<ShiftTeamMember[]> {
  const { data, error } = await getSupabaseClient().rpc("get_shift_staff", {
    p_active_only: activeOnly,
  });
  if (error) throw error;
  return data.map((member) => ({
    id: member.id,
    name: `${member.first_name} ${member.last_name}`.trim(),
  }));
}

export async function getOpenShiftSession(userId: string): Promise<ShiftSession | null> {
  const { data, error } = await getSupabaseClient()
    .from("shift_sessions")
    .select("id,user_id,opened_at,closed_at,opening_cash,closing_cash,note,created_at,shift_id,cash_expected,cash_counted")
    .eq("user_id", userId)
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let shiftName: string | null = null;
  if (data.shift_id) {
    const { data: shift, error: shiftError } = await getSupabaseClient()
      .from("shifts")
      .select("name")
      .eq("id", data.shift_id)
      .maybeSingle();
    if (shiftError) throw shiftError;
    shiftName = shift?.name ?? null;
  }
  return { ...data, shift_name: shiftName };
}

export async function openShiftSession(
  shiftId: string | null,
  openingCash: number,
): Promise<ShiftSession> {
  const { data, error } = await getSupabaseClient().rpc("open_shift", {
    p_shift: shiftId,
    p_opening_cash: openingCash,
  });
  if (error) throw error;
  const { data: shift, error: shiftError } = data.shift_id
    ? await getSupabaseClient().from("shifts").select("name").eq("id", data.shift_id).maybeSingle()
    : { data: null, error: null };
  if (shiftError) throw shiftError;
  return { ...data, shift_name: shift?.name ?? null };
}

export async function getShiftSummary(sessionId: string): Promise<ShiftSummary> {
  const { data, error } = await getSupabaseClient().rpc("get_shift_summary", {
    p_session: sessionId,
  });
  if (error) throw error;
  if (!isRecord(data)) {
    throw new Error("Shift summary response was invalid.");
  }
  return getShiftSummaryFromJson(data);
}

export async function getLastHandoverNote(): Promise<string | null> {
  const { data, error } = await getSupabaseClient().rpc("last_handover_note");
  if (error) throw error;
  if (data !== null && typeof data !== "string") {
    throw new Error("Handover note response was invalid.");
  }
  return data;
}

export async function closeShiftSession(input: {
  sessionId: string;
  countedCash: number;
  note: string;
  confirmUnpaid: boolean;
}): Promise<ShiftSummary> {
  const { data, error } = await getSupabaseClient().rpc("close_shift", {
    p_session: input.sessionId,
    p_cash_counted: input.countedCash,
    p_note: input.note,
    p_confirm_unpaid: input.confirmUnpaid,
  });
  if (error) throw error;
  if (!isRecord(data)) {
    throw new Error("Closed shift summary response was invalid.");
  }
  return getShiftSummaryFromJson(data);
}

function getShiftSummaryFromJson(data: Record<string, Json | undefined>): ShiftSummary {
  const receipts = data.receipts_by_method;
  if (!isRecord(receipts)) throw new Error("Shift summary receipts were invalid.");
  const receiptsByMethod: Record<string, number> = {};
  for (const [method, total] of Object.entries(receipts)) {
    if (typeof total !== "number" || !Number.isFinite(total)) {
      throw new Error("Shift summary receipts were invalid.");
    }
    receiptsByMethod[method] = total;
  }
  const nullableNumber = (value: Json | undefined, field: string): number | null => {
    if (value === null) return null;
    return requiredJsonNumber(value, field);
  };
  return {
    session_id: requiredJsonString(data.session_id, "session_id"),
    shift_id: data.shift_id === null ? null : requiredJsonString(data.shift_id, "shift_id"),
    opened_at: requiredJsonString(data.opened_at, "opened_at"),
    closed_at: data.closed_at === null ? null : requiredJsonString(data.closed_at, "closed_at"),
    opening_cash: requiredJsonNumber(data.opening_cash, "opening_cash"),
    orders_count: requiredJsonNumber(data.orders_count, "orders_count"),
    unpaid_orders: requiredJsonNumber(data.unpaid_orders, "unpaid_orders"),
    receipts_by_method: receiptsByMethod,
    cash_expected: requiredJsonNumber(data.cash_expected, "cash_expected"),
    cash_counted: nullableNumber(data.cash_counted, "cash_counted"),
    cash_difference: nullableNumber(data.cash_difference, "cash_difference"),
  };
}

export async function getShiftUnpaidOrders(sessionId: string): Promise<UnpaidShiftOrder[]> {
  const { data, error } = await getSupabaseClient().rpc("get_shift_unpaid_orders", {
    p_session: sessionId,
  });
  if (error) throw error;
  return data;
}

export async function listClosedShiftSessions(input: {
  from: string;
  to: string;
  userId: string | null;
}): Promise<ShiftSession[]> {
  const endExclusive = new Date(`${input.to}T00:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  let query = getSupabaseClient()
    .from("shift_sessions")
    .select("id,user_id,opened_at,closed_at,opening_cash,closing_cash,note,created_at,shift_id,cash_expected,cash_counted")
    .not("closed_at", "is", null)
    .gte("closed_at", new Date(`${input.from}T00:00:00`).toISOString())
    .lt("closed_at", endExclusive.toISOString())
    .order("closed_at", { ascending: false })
    .limit(250);
  if (input.userId) query = query.eq("user_id", input.userId);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((session) => ({ ...session, shift_name: null }));
}

export async function requestShiftSwap(assignmentId: string, targetUserId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("request_swap", {
    p_assignment: assignmentId,
    p_target: targetUserId,
  });
  if (error) throw error;
}

export async function decideShiftSwap(requestId: string, approve: boolean): Promise<void> {
  const { error } = await getSupabaseClient().rpc("decide_swap", {
    p_request: requestId,
    p_approve: approve,
  });
  if (error) throw error;
}

export function getBusinessDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) throw new Error("Business date could not be calculated.");
  return `${year}-${month}-${day}`;
}
