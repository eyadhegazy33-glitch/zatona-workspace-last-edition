import type { Json } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";

export type OrderStatus =
  | "open"
  | "new"
  | "preparing"
  | "ready"
  | "served"
  | "paid"
  | "cancelled"
  | "voided";

export type OrderBoardItem = {
  name_en: string;
  name_ar: string;
  quantity: number;
  note: string | null;
};

export type OrderBoardRecord = {
  id: string;
  order_number: number;
  status: OrderStatus;
  customer_first_name: string;
  created_at: string;
  items: OrderBoardItem[];
};

export type OrderSummary = {
  id: string;
  order_number: number;
  status: OrderStatus;
  created_at: string;
  customer_id: string;
  customer_name: string;
  customer_first_name: string;
  customer_code: string;
  total: number;
  currency: string;
  paid: boolean;
  receipt_no: string | null;
  receipt_id: string | null;
};

export type OrderHistoryEvent = {
  at: string;
  action: string;
  actor: string;
  details: Record<string, Json | undefined>;
};

export type OrderDetail = OrderSummary & {
  note: string | null;
  subtotal: number;
  discount_total: number;
  discount_reason: string | null;
  service_amount: number;
  tax_amount: number;
  status_updated_at: string | null;
  receipt: {
    id: string;
    receipt_no: string;
    issued_at: string;
    payment_method: string;
    total: number;
    voided: boolean;
    void_reason: string | null;
  } | null;
  items: Array<OrderBoardItem & {
    unit_price: number;
    line_total: number;
  }>;
  history: OrderHistoryEvent[];
};

function row(value: Json | undefined): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Order data was invalid.");
  }
  return value;
}

function string(value: Record<string, Json | undefined>, key: string): string {
  const result = value[key];
  if (typeof result !== "string") throw new Error("Order data was invalid.");
  return result;
}

function nullableString(
  value: Record<string, Json | undefined>,
  key: string,
): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== "string") throw new Error("Order data was invalid.");
  return result;
}

function number(value: Record<string, Json | undefined>, key: string): number {
  const result = value[key];
  const parsed = typeof result === "number" ? result : Number(result);
  if (!Number.isFinite(parsed)) throw new Error("Order data was invalid.");
  return parsed;
}

function boolean(value: Record<string, Json | undefined>, key: string): boolean {
  const result = value[key];
  if (typeof result !== "boolean") throw new Error("Order data was invalid.");
  return result;
}

function status(value: string): OrderStatus {
  if (
    value === "open" ||
    value === "new" ||
    value === "preparing" ||
    value === "ready" ||
    value === "served" ||
    value === "paid" ||
    value === "cancelled" ||
    value === "voided"
  ) return value;
  throw new Error("Order status was invalid.");
}

function mapBoardItem(value: Json | undefined): OrderBoardItem {
  const item = row(value);
  return {
    name_en: string(item, "name_en"),
    name_ar: string(item, "name_ar"),
    quantity: number(item, "quantity"),
    note: nullableString(item, "note"),
  };
}

function mapBoardRecord(value: Json): OrderBoardRecord {
  const item = row(value);
  const items = item.items;
  if (!Array.isArray(items)) throw new Error("Order data was invalid.");
  return {
    id: string(item, "id"),
    order_number: number(item, "order_number"),
    status: status(string(item, "status")),
    customer_first_name: string(item, "customer_first_name"),
    created_at: string(item, "created_at"),
    items: items.map(mapBoardItem),
  };
}

function mapSummary(item: Record<string, Json | undefined>): OrderSummary {
  return {
    id: string(item, "id"),
    order_number: number(item, "order_number"),
    status: status(string(item, "status")),
    created_at: string(item, "created_at"),
    customer_id: string(item, "customer_id"),
    customer_name: string(item, "customer_name"),
    customer_first_name: string(item, "customer_first_name"),
    customer_code: string(item, "customer_code"),
    total: number(item, "total"),
    currency: string(item, "currency"),
    paid: boolean(item, "paid"),
    receipt_no: nullableString(item, "receipt_no"),
    receipt_id: nullableString(item, "receipt_id"),
  };
}

export async function listOrderBoard(): Promise<OrderBoardRecord[]> {
  const { data, error } = await getSupabaseClient().rpc("list_order_board");
  if (error) throw error;
  return data.map(mapBoardRecord);
}

export async function getOrderDetail(id: string): Promise<OrderDetail> {
  const { data, error } = await getSupabaseClient().rpc("get_order_detail", {
    p_order: id,
  });
  if (error) throw error;
  const detail = row(data);
  const items = detail.items;
  const history = detail.history;
  if (!Array.isArray(items) || !Array.isArray(history)) {
    throw new Error("Order details were invalid.");
  }
  const receiptData = detail.receipt;
  let receipt: OrderDetail["receipt"] = null;
  if (receiptData !== null && receiptData !== undefined) {
    const receiptRow = row(receiptData);
    receipt = {
      id: string(receiptRow, "id"),
      receipt_no: string(receiptRow, "receipt_no"),
      issued_at: string(receiptRow, "issued_at"),
      payment_method: string(receiptRow, "payment_method"),
      total: number(receiptRow, "total"),
      voided: boolean(receiptRow, "voided"),
      void_reason: nullableString(receiptRow, "void_reason"),
    };
  }
  return {
    ...mapSummary(detail),
    note: nullableString(detail, "note"),
    subtotal: number(detail, "subtotal"),
    discount_total: number(detail, "discount_total"),
    discount_reason: nullableString(detail, "discount_reason"),
    service_amount: number(detail, "service_amount"),
    tax_amount: number(detail, "tax_amount"),
    status_updated_at: nullableString(detail, "status_updated_at"),
    receipt,
    items: items.map((value) => {
      const item = row(value);
      return {
        ...mapBoardItem(value),
        unit_price: number(item, "unit_price"),
        line_total: number(item, "line_total"),
      };
    }),
    history: history.map((value) => {
      const event = row(value);
      const details = event.details;
      if (!details || typeof details !== "object" || Array.isArray(details)) {
        throw new Error("Order history was invalid.");
      }
      return {
        at: string(event, "at"),
        action: string(event, "action"),
        actor: string(event, "actor"),
        details,
      };
    }),
  };
}

export async function listOrders(filters: {
  from: string | null;
  to: string | null;
  status: string;
  search: string;
  unpaidOnly: boolean;
}): Promise<OrderSummary[]> {
  const { data, error } = await getSupabaseClient().rpc("list_orders", {
    p_from: filters.from,
    p_to: filters.to,
    p_status: filters.status,
    p_search: filters.search.trim() || null,
    p_unpaid_only: filters.unpaidOnly,
  });
  if (error) throw error;
  return data.map((value) => mapSummary(row(value)));
}

export async function setOrderStatus(
  id: string,
  next: "preparing" | "ready" | "served",
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_order_status", {
    p_order: id,
    p_status: next,
  });
  if (error) throw error;
}

export async function cancelOrder(id: string, reason: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("cancel_order", {
    p_order: id,
    p_reason: reason,
  });
  if (error) throw error;
}
