import type { Json } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";

export type PosSettings = {
  currency: string;
  visit_duration_minutes: number;
  fee_interval_minutes: number;
  fee_amount: number;
  timezone: string;
  tax_percent: number;
  service_percent: number;
  timer_warning_minutes: number;
  timer_grace_minutes: number;
  fee_repeats: boolean;
  timer_reset_on: "order_created" | "order_paid";
  require_open_shift: boolean;
  receipt_prefix: string;
  cash_diff_alert: number;
  server_now: string;
};

export type PosCategory = {
  id: string;
  name_en: string;
  name_ar: string;
  sort: number;
  active: boolean;
};

export type PosProduct = {
  id: string;
  category_id: string | null;
  category_name_en: string | null;
  category_name_ar: string | null;
  name_en: string;
  name_ar: string;
  description: string | null;
  price: number;
  qualifies_for_time: boolean;
  active: boolean;
  available: boolean;
  image_path: string | null;
  sort: number;
  created_at: string;
};

export type PosShift = {
  id: string;
  user_id: string;
  opened_at: string;
  opening_cash: number;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  schedule_shift_id: string | null;
  schedule_shift_name: string | null;
  cash_diff_alert?: boolean;
};

export type PosVisit = {
  checkin_id: number;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  checked_in_at: string;
  deadline: string;
  server_now: string;
  resource_name: string | null;
};

export type PosOrderItem = {
  name_en: string;
  name_ar: string;
  quantity: number;
  line_total: number;
};

export type PosOpenOrder = {
  id: string;
  order_number: number;
  status: "open" | "new" | "preparing" | "ready" | "served";
  customer_id: string;
  checkin_id: number;
  customer_name: string;
  customer_code: string;
  created_at: string;
  subtotal: number;
  discount_total: number;
  service_amount: number;
  tax_amount: number;
  total: number;
  currency: string;
  items: PosOrderItem[];
};

export type PosReceipt = {
  id: string;
  receipt_no: string;
  issued_at: string;
  total: number;
  currency: string;
  payment_method: "cash" | "card" | "other";
  voided: boolean;
  void_reason: string | null;
  customer_name: string;
  customer_code: string;
};

export type VisitFee = {
  id: string;
  checkin_id: number;
  customer_id?: string;
  amount: number;
  currency: string;
  created_at: string;
  customer_name: string;
  customer_code: string;
  waived: boolean;
  paid: boolean;
  source: "visit" | "timer";
};

export type OrderCreateResult = {
  order_id: string;
  order_number: number;
  subtotal: number;
  discount_total: number;
  service_amount: number;
  tax_amount: number;
  total: number;
  currency: string;
  server_now: string;
};

export type PaymentResult = {
  order_id?: string;
  receipt_id?: string;
  receipt_no: string;
  total: number;
  currency: string;
  payment_method: "cash" | "card" | "other";
  qualifies_for_time?: boolean;
  server_now: string;
};

export type CheckoutTicketItem = {
  kind: "order_item" | "visit_fee" | "timer_fee";
  name_en: string | null;
  name_ar: string | null;
  quantity: number;
  line_total: number;
  order_number?: number;
};

export type CheckoutTicket = {
  ticket_id: string;
  ticket_no: string;
  checkin_id: number;
  customer_id: string;
  customer_name: string;
  customer_code: string;
  payment_method: PosReceipt["payment_method"];
  currency: string;
  total: number;
  items: CheckoutTicketItem[];
  issued_at: string;
  checked_out_at: string;
  server_now: string;
};

function record(value: Json | undefined): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Point-of-sale response was invalid.");
  }
  return value;
}

function requiredString(
  value: Record<string, Json | undefined>,
  key: string,
): string {
  const result = value[key];
  if (typeof result !== "string") {
    throw new Error("Point-of-sale response was invalid.");
  }
  return result;
}

function nullableString(
  value: Record<string, Json | undefined>,
  key: string,
): string | null {
  const result = value[key];
  if (result === null || result === undefined) return null;
  if (typeof result !== "string") {
    throw new Error("Point-of-sale response was invalid.");
  }
  return result;
}

function requiredNumber(
  value: Record<string, Json | undefined>,
  key: string,
): number {
  const result = value[key];
  const parsed = typeof result === "number" ? result : Number(result);
  if (!Number.isFinite(parsed)) {
    throw new Error("Point-of-sale response was invalid.");
  }
  return parsed;
}

function requiredBoolean(
  value: Record<string, Json | undefined>,
  key: string,
): boolean {
  const result = value[key];
  if (typeof result !== "boolean") {
    throw new Error("Point-of-sale response was invalid.");
  }
  return result;
}

function mapCategory(value: Json): PosCategory {
  const row = record(value);
  return {
    id: requiredString(row, "id"),
    name_en: requiredString(row, "name_en"),
    name_ar: requiredString(row, "name_ar"),
    sort: requiredNumber(row, "sort"),
    active: requiredBoolean(row, "active"),
  };
}

function mapProduct(value: Json): PosProduct {
  const row = record(value);
  return {
    id: requiredString(row, "id"),
    category_id: nullableString(row, "category_id"),
    category_name_en: nullableString(row, "category_name_en"),
    category_name_ar: nullableString(row, "category_name_ar"),
    name_en: requiredString(row, "name_en"),
    name_ar: requiredString(row, "name_ar"),
    description: nullableString(row, "description"),
    price: requiredNumber(row, "price"),
    qualifies_for_time: requiredBoolean(row, "qualifies_for_time"),
    active: requiredBoolean(row, "active"),
    available: requiredBoolean(row, "available"),
    image_path: nullableString(row, "image_path"),
    sort: requiredNumber(row, "sort"),
    created_at: requiredString(row, "created_at"),
  };
}

function mapShift(value: Json): PosShift | null {
  if (value === null) return null;
  const row = record(value);
  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    opened_at: requiredString(row, "opened_at"),
    opening_cash: requiredNumber(row, "opening_cash"),
    closed_at: nullableString(row, "closed_at"),
    counted_cash:
      row.counted_cash == null ? null : requiredNumber(row, "counted_cash"),
    expected_cash:
      row.expected_cash == null ? null : requiredNumber(row, "expected_cash"),
    variance: row.variance == null ? null : requiredNumber(row, "variance"),
    schedule_shift_id: nullableString(row, "schedule_shift_id"),
    schedule_shift_name: row.schedule_shift_name == null
      ? null
      : requiredString(row, "schedule_shift_name"),
    cash_diff_alert: row.cash_diff_alert === true,
  };
}

function mapVisit(value: Json): PosVisit {
  const row = record(value);
  return {
    checkin_id: requiredNumber(row, "checkin_id"),
    customer_id: requiredString(row, "customer_id"),
    customer_name: requiredString(row, "customer_name"),
    customer_code: requiredString(row, "customer_code"),
    checked_in_at: requiredString(row, "checked_in_at"),
    deadline: requiredString(row, "deadline"),
    server_now: requiredString(row, "server_now"),
    resource_name: nullableString(row, "resource_name"),
  };
}

function mapOpenOrder(value: Json): PosOpenOrder {
  const row = record(value);
  const status = requiredString(row, "status");
  if (!["open", "new", "preparing", "ready", "served"].includes(status)) {
    throw new Error("Point-of-sale response was invalid.");
  }
  const rawItems = row.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("Point-of-sale response was invalid.");
  }
  const items = rawItems.map((item) => {
    const itemRecord = record(item);
    return {
      name_en: requiredString(itemRecord, "name_en"),
      name_ar: requiredString(itemRecord, "name_ar"),
      quantity: requiredNumber(itemRecord, "quantity"),
      line_total: requiredNumber(itemRecord, "line_total"),
    };
  });
  return {
    id: requiredString(row, "id"),
    order_number: requiredNumber(row, "order_number"),
    status: status as PosOpenOrder["status"],
    customer_id: requiredString(row, "customer_id"),
    checkin_id: requiredNumber(row, "checkin_id"),
    customer_name: requiredString(row, "customer_name"),
    customer_code: requiredString(row, "customer_code"),
    created_at: requiredString(row, "created_at"),
    subtotal: requiredNumber(row, "subtotal"),
    discount_total: requiredNumber(row, "discount_total"),
    service_amount: requiredNumber(row, "service_amount"),
    tax_amount: requiredNumber(row, "tax_amount"),
    total: requiredNumber(row, "total"),
    currency: requiredString(row, "currency"),
    items,
  };
}

function mapReceipt(value: Json): PosReceipt {
  const row = record(value);
  const paymentMethod = requiredString(row, "payment_method");
  if (!["cash", "card", "other"].includes(paymentMethod)) {
    throw new Error("Point-of-sale response was invalid.");
  }
  return {
    id: requiredString(row, "id"),
    receipt_no: requiredString(row, "receipt_no"),
    issued_at: requiredString(row, "issued_at"),
    total: requiredNumber(row, "total"),
    currency: requiredString(row, "currency"),
    payment_method: paymentMethod as PosReceipt["payment_method"],
    voided: requiredBoolean(row, "voided"),
    void_reason: nullableString(row, "void_reason"),
    customer_name: requiredString(row, "customer_name"),
    customer_code: requiredString(row, "customer_code"),
  };
}

function mapCheckoutTicket(value: Json): CheckoutTicket {
  const row = record(value);
  const paymentMethod = requiredString(row, "payment_method");
  if (!["cash", "card", "other"].includes(paymentMethod)) {
    throw new Error("Checkout response was invalid.");
  }
  if (!Array.isArray(row.items)) throw new Error("Checkout response was invalid.");
  const items = row.items.map((item) => {
    const itemRow = record(item);
    const kind = requiredString(itemRow, "kind");
    if (!["order_item", "visit_fee", "timer_fee"].includes(kind)) {
      throw new Error("Checkout response was invalid.");
    }
    return {
      kind: kind as CheckoutTicketItem["kind"],
      name_en: nullableString(itemRow, "name_en"),
      name_ar: nullableString(itemRow, "name_ar"),
      quantity: requiredNumber(itemRow, "quantity"),
      line_total: requiredNumber(itemRow, "line_total"),
      ...(itemRow.order_number == null
        ? {}
        : { order_number: requiredNumber(itemRow, "order_number") }),
    };
  });
  return {
    ticket_id: requiredString(row, "ticket_id"),
    ticket_no: requiredString(row, "ticket_no"),
    checkin_id: requiredNumber(row, "checkin_id"),
    customer_id: requiredString(row, "customer_id"),
    customer_name: requiredString(row, "customer_name"),
    customer_code: requiredString(row, "customer_code"),
    payment_method: paymentMethod as CheckoutTicket["payment_method"],
    currency: requiredString(row, "currency"),
    total: requiredNumber(row, "total"),
    items,
    issued_at: requiredString(row, "issued_at"),
    checked_out_at: requiredString(row, "checked_out_at"),
    server_now: requiredString(row, "server_now"),
  };
}

function mapFee(value: Json): VisitFee {
  const row = record(value);
  return {
    id: requiredString(row, "id"),
    checkin_id: requiredNumber(row, "checkin_id"),
    amount: requiredNumber(row, "amount"),
    currency: requiredString(row, "currency"),
    created_at: requiredString(row, "created_at"),
    customer_name: requiredString(row, "customer_name"),
    customer_code: requiredString(row, "customer_code"),
    waived: requiredBoolean(row, "waived"),
    paid: requiredBoolean(row, "paid"),
    source: "visit",
  };
}

function mapTimerFee(value: Json): VisitFee {
  const row = record(value);
  if (row.timer_fee !== true) {
    throw new Error("Point-of-sale response was invalid.");
  }
  return {
    id: requiredString(row, "id"),
    checkin_id: requiredNumber(row, "checkin_id"),
    customer_id: requiredString(row, "customer_id"),
    amount: requiredNumber(row, "amount"),
    currency: requiredString(row, "currency"),
    created_at: requiredString(row, "created_at"),
    customer_name: requiredString(row, "customer_name"),
    customer_code: requiredString(row, "customer_code"),
    waived: requiredBoolean(row, "waived"),
    paid: requiredBoolean(row, "paid"),
    source: "timer",
  };
}

function mapSettings(value: Json | null): PosSettings {
  const row = record(value ?? undefined);
  const timerResetOn = requiredString(row, "timer_reset_on");
  if (timerResetOn !== "order_created" && timerResetOn !== "order_paid") {
    throw new Error("Point-of-sale response was invalid.");
  }
  return {
    currency: requiredString(row, "currency"),
    visit_duration_minutes: requiredNumber(row, "visit_duration_minutes"),
    fee_interval_minutes: requiredNumber(row, "fee_interval_minutes"),
    fee_amount: requiredNumber(row, "fee_amount"),
    timezone: requiredString(row, "timezone"),
    tax_percent: requiredNumber(row, "tax_percent"),
    service_percent: requiredNumber(row, "service_percent"),
    timer_warning_minutes: requiredNumber(row, "timer_warning_minutes"),
    timer_grace_minutes: requiredNumber(row, "timer_grace_minutes"),
    fee_repeats: requiredBoolean(row, "fee_repeats"),
    timer_reset_on: timerResetOn,
    require_open_shift: requiredBoolean(row, "require_open_shift"),
    receipt_prefix: requiredString(row, "receipt_prefix"),
    cash_diff_alert: requiredNumber(row, "cash_diff_alert"),
    server_now: requiredString(row, "server_now"),
  };
}

function mapOrderCreate(value: Json | null): OrderCreateResult {
  const row = record(value ?? undefined);
  return {
    order_id: requiredString(row, "order_id"),
    order_number: requiredNumber(row, "order_number"),
    subtotal: requiredNumber(row, "subtotal"),
    discount_total: requiredNumber(row, "discount_total"),
    service_amount: requiredNumber(row, "service_amount"),
    tax_amount: requiredNumber(row, "tax_amount"),
    total: requiredNumber(row, "total"),
    currency: requiredString(row, "currency"),
    server_now: requiredString(row, "server_now"),
  };
}

function mapPayment(value: Json | null): PaymentResult {
  const row = record(value ?? undefined);
  const paymentMethod = requiredString(row, "payment_method");
  if (!["cash", "card", "other"].includes(paymentMethod)) {
    throw new Error("Point-of-sale response was invalid.");
  }
  return {
    order_id: nullableString(row, "order_id") ?? undefined,
    receipt_id: nullableString(row, "receipt_id") ?? undefined,
    receipt_no: requiredString(row, "receipt_no"),
    total: requiredNumber(row, "total"),
    currency: requiredString(row, "currency"),
    payment_method: paymentMethod as PaymentResult["payment_method"],
    qualifies_for_time:
      typeof row.qualifies_for_time === "boolean"
        ? row.qualifies_for_time
        : undefined,
    server_now: requiredString(row, "server_now"),
  };
}

export async function getPosSettings(): Promise<PosSettings> {
  const { data, error } = await getSupabaseClient().rpc("get_pos_settings");
  if (error) throw error;
  return mapSettings(data);
}

export async function updatePosSettings(input: {
  currency: string;
  visitDurationMinutes: number;
  feeIntervalMinutes: number;
  feeAmount: number;
  timezone: string;
  taxPercent: number;
  servicePercent: number;
  timerWarningMinutes: number;
  timerGraceMinutes: number;
  feeRepeats: boolean;
  timerResetOn: PosSettings["timer_reset_on"];
  requireOpenShift: boolean;
  receiptPrefix: string;
  cashDiffAlert: number;
}): Promise<PosSettings> {
  const { data, error } = await getSupabaseClient().rpc("update_pos_settings", {
    p_currency: input.currency,
    p_visit_duration_minutes: input.visitDurationMinutes,
    p_fee_interval_minutes: input.feeIntervalMinutes,
    p_fee_amount: input.feeAmount,
    p_timezone: input.timezone,
    p_tax_percent: input.taxPercent,
    p_service_percent: input.servicePercent,
    p_timer_warning_minutes: input.timerWarningMinutes,
    p_timer_grace_minutes: input.timerGraceMinutes,
    p_fee_repeats: input.feeRepeats,
    p_timer_reset_on: input.timerResetOn,
    p_require_open_shift: input.requireOpenShift,
    p_receipt_prefix: input.receiptPrefix,
    p_cash_diff_alert: input.cashDiffAlert,
  });
  if (error) throw error;
  return mapSettings(data);
}

export async function listPosCategories(): Promise<PosCategory[]> {
  const { data, error } = await getSupabaseClient().rpc("list_pos_categories");
  if (error) throw error;
  return data.map(mapCategory);
}

export async function savePosCategory(input: {
  id: string | null;
  nameEn: string;
  nameAr: string;
  sort: number;
  active: boolean;
}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("save_pos_category", {
    p_id: input.id,
    p_name_en: input.nameEn,
    p_name_ar: input.nameAr,
    p_sort: input.sort,
    p_active: input.active,
  });
  if (error) throw error;
  return data;
}

export async function listPosProducts(): Promise<PosProduct[]> {
  const { data, error } = await getSupabaseClient().rpc("list_pos_products");
  if (error) throw error;
  return data.map(mapProduct);
}

export async function savePosMenuItem(input: {
  id: string | null;
  categoryId: string;
  nameEn: string;
  nameAr: string;
  description: string;
  price: number;
  countsForMinimum: boolean;
  available: boolean;
  active: boolean;
  imagePath: string | null;
  sort: number;
}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("save_pos_menu_item", {
    p_id: input.id,
    p_category_id: input.categoryId,
    p_name_en: input.nameEn,
    p_name_ar: input.nameAr,
    p_description: input.description,
    p_price: input.price,
    p_counts_for_minimum: input.countsForMinimum,
    p_available: input.available,
    p_active: input.active,
    p_image_path: input.imagePath,
    p_sort: input.sort,
  });
  if (error) throw error;
  return data;
}

export async function uploadPosMenuImage(file: File): Promise<string> {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("pos.errors.menuImageType");
  if (file.size > 1024 * 1024) throw new Error("pos.errors.menuImageSize");
  const path = `items/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await getSupabaseClient()
    .storage.from("menu")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return data.path;
}

export async function deletePosMenuImage(path: string): Promise<void> {
  if (!/^items\/[A-Za-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(path)) {
    throw new Error("Invalid menu image path.");
  }
  const { error } = await getSupabaseClient().storage.from("menu").remove([path]);
  if (error) throw error;
}

export function getPosMenuImageUrl(path: string): string {
  const { data } = getSupabaseClient().storage.from("menu").getPublicUrl(path);
  return data.publicUrl;
}

export async function getCurrentPosShift(): Promise<{
  shift: PosShift | null;
  serverNow: string;
}> {
  const { data, error } = await getSupabaseClient().rpc("get_current_pos_shift");
  if (error) throw error;
  const row = record(data);
  return {
    shift: mapShift(row.shift ?? null),
    serverNow: requiredString(row, "server_now"),
  };
}

export async function openPosShift(
  openingCash: number,
  scheduleShiftId: string | null,
): Promise<PosShift> {
  const { data, error } = await getSupabaseClient().rpc("open_pos_shift", {
    p_opening_cash: openingCash,
    p_schedule_shift: scheduleShiftId,
  });
  if (error) throw error;
  const row = record(data);
  const shift = mapShift(row.shift ?? null);
  if (!shift) throw new Error("Point-of-sale response was invalid.");
  return shift;
}

export async function closePosShift(
  shiftId: string,
  countedCash: number,
): Promise<PosShift> {
  const { data, error } = await getSupabaseClient().rpc("close_pos_shift", {
    p_shift: shiftId,
    p_counted_cash: countedCash,
  });
  if (error) throw error;
  const row = record(data);
  const shift = mapShift(row.shift ?? null);
  if (!shift) throw new Error("Point-of-sale response was invalid.");
  return {
    ...shift,
    cash_diff_alert: requiredBoolean(row, "cash_diff_alert"),
  };
}

export async function listOpenPosVisits(): Promise<PosVisit[]> {
  const { data, error } = await getSupabaseClient().rpc("list_open_pos_visits");
  if (error) throw error;
  return data.map(mapVisit);
}

export async function listOpenPosOrders(): Promise<PosOpenOrder[]> {
  const { data, error } = await getSupabaseClient().rpc("list_open_pos_orders");
  if (error) throw error;
  return data.map(mapOpenOrder);
}

export async function createPosOrder(input: {
  customerId: string;
  checkinId: number;
  items: Array<{ product_id: string; quantity: string }>;
  discountType: "amount" | "percent" | null;
  discountValue: number;
  discountReason: string | null;
}): Promise<OrderCreateResult> {
  const { data, error } = await getSupabaseClient().rpc("create_pos_order", {
    p_customer: input.customerId,
    p_checkin: input.checkinId,
    p_items: input.items,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_discount_reason: input.discountReason,
  });
  if (error) throw error;
  return mapOrderCreate(data);
}

export async function setPosOrderStatus(
  orderId: string,
  status: "preparing" | "ready" | "served",
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_pos_order_status", {
    p_order: orderId,
    p_status: status,
  });
  if (error) throw error;
}

export async function completePosOrder(
  orderId: string,
  paymentMethod: PosReceipt["payment_method"],
): Promise<PaymentResult> {
  const { data, error } = await getSupabaseClient().rpc("complete_pos_order", {
    p_order: orderId,
    p_payment_method: paymentMethod,
  });
  if (error) throw error;
  return mapPayment(data);
}

export async function cancelPosOrder(
  orderId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("cancel_pos_order", {
    p_order: orderId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function listPosReceipts(): Promise<PosReceipt[]> {
  const { data, error } = await getSupabaseClient().rpc("list_pos_receipts");
  if (error) throw error;
  return data.map(mapReceipt);
}

export async function voidPosReceipt(
  receiptId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("void_pos_receipt", {
    p_receipt: receiptId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function listVisitFees(): Promise<VisitFee[]> {
  const { data, error } = await getSupabaseClient().rpc("list_visit_fees");
  if (error) throw error;
  return data.map(mapFee);
}

export async function listTimerFees(): Promise<VisitFee[]> {
  const { data, error } = await getSupabaseClient().rpc("list_timer_fees");
  if (error) throw error;
  return data.map(mapTimerFee);
}

export async function waiveVisitFee(
  feeId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("waive_visit_fee", {
    p_fee: feeId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function waiveTimerFee(
  feeId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("waive_fee", {
    p_fee: feeId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function payVisitFee(
  feeId: string,
  paymentMethod: PosReceipt["payment_method"],
): Promise<PaymentResult> {
  const { data, error } = await getSupabaseClient().rpc("pay_visit_fee", {
    p_fee: feeId,
    p_payment_method: paymentMethod,
  });
  if (error) throw error;
  return mapPayment(data);
}

export async function payTimerFee(
  feeId: string,
  paymentMethod: PosReceipt["payment_method"],
): Promise<PaymentResult> {
  const { data, error } = await getSupabaseClient().rpc("pay_timer_fee", {
    p_fee: feeId,
    p_payment_method: paymentMethod,
  });
  if (error) throw error;
  return mapPayment(data);
}

export async function checkoutVisit(
  checkinId: number,
  paymentMethod: PosReceipt["payment_method"],
): Promise<CheckoutTicket> {
  const { data, error } = await getSupabaseClient().rpc("checkout_visit", {
    p_checkin: checkinId,
    p_payment_method: paymentMethod,
  });
  if (error) throw error;
  return mapCheckoutTicket(data);
}
