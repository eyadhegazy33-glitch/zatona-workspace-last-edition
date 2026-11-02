import type { Json } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";

export type ReceiptMethod = "cash" | "card" | "wallet" | "other";
export type ReceiptStatus = "paid" | "voided";
export type ReceiptSort = "created_at" | "number" | "customer" | "employee" | "total" | "status";

export type ReceiptFilters = {
  search: string;
  from: string | null;
  to: string | null;
  method: ReceiptMethod | null;
  status: ReceiptStatus | null;
  minAmount: number | null;
  maxAmount: number | null;
  sort: ReceiptSort;
  direction: "asc" | "desc";
};

export type ReceiptListItem = {
  id: string;
  number: number;
  display_number: string;
  created_at: string;
  total: number;
  method: ReceiptMethod;
  status: ReceiptStatus;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  created_by: string | null;
  employee_name: string | null;
};

export type ReceiptLine = {
  id: number;
  line_type: "order" | "fee";
  order_id: string | null;
  fee_id: string | null;
  description: string;
  amount: number;
};

export type ReceiptShift = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  note: string | null;
};

export type ReceiptDetail = ReceiptListItem & {
  subtotal: number;
  discount: number;
  service_charge: number;
  tax: number;
  amount_received: number | null;
  note: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
  shift: ReceiptShift | null;
  lines: ReceiptLine[];
};

export type ReceiptPage = {
  rows: ReceiptListItem[];
  total_count: number;
  paid_count: number;
  paid_total: number;
  voided_count: number;
};

function isRecord(value: Json | null | undefined): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: Json | undefined, field: string): string {
  if (typeof value !== "string") throw new Error(`Receipt field ${field} was invalid.`);
  return value;
}

function readNullableString(value: Json | undefined, field: string): string | null {
  if (value === null) return null;
  return readString(value, field);
}

function readNumber(value: Json | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Receipt field ${field} was invalid.`);
  }
  return value;
}

function readNullableNumber(value: Json | undefined, field: string): number | null {
  if (value === null) return null;
  return readNumber(value, field);
}

function readMethod(value: Json | undefined): ReceiptMethod {
  if (value === "cash" || value === "card" || value === "wallet" || value === "other") {
    return value;
  }
  throw new Error("Receipt payment method was invalid.");
}

function readStatus(value: Json | undefined): ReceiptStatus {
  if (value === "paid" || value === "voided") return value;
  throw new Error("Receipt status was invalid.");
}

function readLineType(value: Json | undefined): "order" | "fee" {
  if (value === "order" || value === "fee") return value;
  throw new Error("Receipt line type was invalid.");
}

function parseReceipt(value: Json): ReceiptListItem {
  if (!isRecord(value)) throw new Error("Receipt list item was invalid.");
  return {
    id: readString(value.id, "id"),
    number: readNumber(value.number, "number"),
    display_number: readString(value.display_number, "display_number"),
    created_at: readString(value.created_at, "created_at"),
    total: readNumber(value.total, "total"),
    method: readMethod(value.method),
    status: readStatus(value.status),
    customer_id: readString(value.customer_id, "customer_id"),
    customer_name: readString(value.customer_name, "customer_name"),
    customer_code: readString(value.customer_code, "customer_code"),
    created_by: readNullableString(value.created_by, "created_by"),
    employee_name: readNullableString(value.employee_name, "employee_name"),
  };
}

function parseArray<T>(value: Json | undefined, parser: (item: Json) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Receipt response list was invalid.");
  return value.map(parser);
}

export async function listReceipts(
  filters: ReceiptFilters,
  offset: number,
  limit = 25,
): Promise<ReceiptPage> {
  const { data, error } = await getSupabaseClient().rpc("list_receipts_browser", {
    p_search: filters.search.trim() || null,
    p_from: filters.from,
    p_to: filters.to,
    p_method: filters.method,
    p_status: filters.status,
    p_min_amount: filters.minAmount,
    p_max_amount: filters.maxAmount,
    p_sort: filters.sort,
    p_direction: filters.direction,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Receipt list response was invalid.");
  return {
    rows: parseArray(data.rows, parseReceipt),
    total_count: readNumber(data.total_count, "total_count"),
    paid_count: readNumber(data.paid_count, "paid_count"),
    paid_total: readNumber(data.paid_total, "paid_total"),
    voided_count: readNumber(data.voided_count, "voided_count"),
  };
}

export async function getReceiptDetail(receiptId: string): Promise<ReceiptDetail> {
  const { data, error } = await getSupabaseClient().rpc("get_receipt_browser_detail", {
    p_receipt: receiptId,
  });
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Receipt detail response was invalid.");
  const base = parseReceipt(data);
  const shiftData = data.shift;
  let shift: ReceiptShift | null = null;
  if (shiftData !== null) {
    if (!isRecord(shiftData)) throw new Error("Receipt shift details were invalid.");
    shift = {
      id: readString(shiftData.id, "shift.id"),
      opened_at: readString(shiftData.opened_at, "shift.opened_at"),
      closed_at: readNullableString(shiftData.closed_at, "shift.closed_at"),
      opening_cash: readNumber(shiftData.opening_cash, "shift.opening_cash"),
      closing_cash: readNullableNumber(shiftData.closing_cash, "shift.closing_cash"),
      note: readNullableString(shiftData.note, "shift.note"),
    };
  }
  const lines = parseArray(data.lines, (item) => {
    if (!isRecord(item)) throw new Error("Receipt line was invalid.");
    return {
      id: readNumber(item.id, "line.id"),
      line_type: readLineType(item.line_type),
      order_id: readNullableString(item.order_id, "line.order_id"),
      fee_id: readNullableString(item.fee_id, "line.fee_id"),
      description: readString(item.description, "line.description"),
      amount: readNumber(item.amount, "line.amount"),
    };
  });
  return {
    ...base,
    subtotal: readNumber(data.subtotal, "subtotal"),
    discount: readNumber(data.discount, "discount"),
    service_charge: readNumber(data.service_charge, "service_charge"),
    tax: readNumber(data.tax, "tax"),
    amount_received: readNullableNumber(data.amount_received, "amount_received"),
    note: readNullableString(data.note, "note"),
    voided_by: readNullableString(data.voided_by, "voided_by"),
    voided_by_name: readNullableString(data.voided_by_name, "voided_by_name"),
    voided_at: readNullableString(data.voided_at, "voided_at"),
    void_reason: readNullableString(data.void_reason, "void_reason"),
    shift,
    lines,
  };
}

export async function voidReceipt(receiptId: string, reason: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("void_receipt", {
    p_receipt: receiptId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
}
