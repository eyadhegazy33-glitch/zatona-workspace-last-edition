import { getSupabaseClient } from "../lib/supabase";
import type { Json } from "../lib/database.types";

export type CustomerPaymentMethod = "cash" | "card" | "wallet" | "other";

export type UnpaidOrder = {
  id: string;
  number: number;
  customer_id: string;
  description: string;
  subtotal: number;
  discount: number;
  service_charge: number;
  tax: number;
  total: number;
  status: string;
  receipt_id: string | null;
  created_at: string;
};

export type DueCustomerFee = {
  id: string;
  checkin_id: number;
  customer_id: string;
  amount: number;
  block_number: number;
  created_at: string;
};

export type CustomerPaymentReceipt = {
  id: string;
  number: number;
  customer_id: string;
  subtotal: number;
  discount: number;
  service_charge: number;
  tax: number;
  total: number;
  method: CustomerPaymentMethod;
  status: "paid" | "voided";
  amount_received: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};

export type PaymentCustomer = {
  id: string;
  full_name: string;
  code: string;
  checkin_id: number | null;
};

function isRecord(value: Json | null): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function getCustomerPaymentContext(
  customerId: string,
): Promise<PaymentCustomer> {
  const { data, error } = await getSupabaseClient().rpc(
    "get_customer_payment_context",
    { p_customer: customerId },
  );
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Customer payment response was invalid.");
  const checkinId = data.checkin_id;
  if (
    typeof data.id !== "string" ||
    typeof data.full_name !== "string" ||
    typeof data.code !== "string" ||
    (checkinId !== null && checkinId !== undefined && typeof checkinId !== "number")
  ) {
    throw new Error("Customer payment response was invalid.");
  }
  return {
    id: data.id,
    full_name: data.full_name,
    code: data.code,
    checkin_id: typeof checkinId === "number" ? checkinId : null,
  };
}

export async function listCustomerPaymentItems(customerId: string): Promise<{
  orders: UnpaidOrder[];
  fees: DueCustomerFee[];
}> {
  const client = getSupabaseClient();
  const [ordersResult, feesResult] = await Promise.all([
    client
      .from("orders")
      .select(
        "id, number, customer_id, description, subtotal, discount, service_charge, tax, total, status, receipt_id, created_at",
      )
      .eq("customer_id", customerId)
      .is("receipt_id", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true }),
    client
      .from("fees")
      .select("id, checkin_id, customer_id, amount, block_number, created_at")
      .eq("customer_id", customerId)
      .eq("status", "due")
      .order("created_at", { ascending: true }),
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (feesResult.error) throw feesResult.error;
  return {
    orders: ordersResult.data,
    fees: feesResult.data,
  };
}

export async function collectCustomerPayment(input: {
  customerId: string;
  orderIds: string[];
  feeIds: string[];
  method: CustomerPaymentMethod;
  amountReceived: number | null;
  note: string;
}): Promise<CustomerPaymentReceipt> {
  const { data, error } = await getSupabaseClient().rpc("collect_payment", {
    p_customer: input.customerId,
    p_order_ids: input.orderIds,
    p_fee_ids: input.feeIds,
    p_method: input.method,
    p_amount_received: input.amountReceived,
    p_note: input.note.trim() || null,
  });
  if (error) throw error;
  if (!data || !data.id || !Number.isFinite(data.number) || !data.created_at) {
    throw new Error("Payment receipt response was invalid.");
  }
  return data;
}

export async function waiveCustomerFee(
  feeId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("waive_fee", {
    p_fee: feeId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
}
