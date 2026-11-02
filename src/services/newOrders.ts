import type { Json } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";
import {
  listOpenPosVisits,
  type PosVisit,
} from "./pointOfSale";

export type OrderMenuCategory = {
  id: string;
  name_en: string;
  name_ar: string;
  sort: number;
};

export type OrderMenuItem = {
  id: string;
  category_id: string | null;
  name_en: string;
  name_ar: string;
  description: string | null;
  price: number;
  qualifies_for_time: boolean;
  active: boolean;
  available: boolean;
  image_path: string | null;
  sort: number;
};

export type OrderCustomerCandidate = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
};

export type NewOrderResult = {
  order_id: string;
  order_number: number;
  subtotal: number;
  discount_total: number;
  service_amount: number;
  tax_amount: number;
  total: number;
  currency: string;
  timer_restarted: boolean;
  server_now: string;
  items: Array<{
    name_en: string;
    name_ar: string;
    quantity: number;
    note: string | null;
  }>;
};

function isRecord(value: Json | null): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(
  row: Record<string, Json | undefined>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Order response was invalid.");
  return value;
}

function requiredNumber(
  row: Record<string, Json | undefined>,
  key: string,
): number {
  const value = row[key];
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error("Order response was invalid.");
  return number;
}

export async function listOrderMenu(): Promise<{
  categories: OrderMenuCategory[];
  items: OrderMenuItem[];
}> {
  const client = getSupabaseClient();
  const [categoriesResult, itemsResult] = await Promise.all([
    client
      .from("pos_menu_categories")
      .select("id,name_en,name_ar,sort")
      .eq("active", true)
      .order("sort")
      .order("name_en"),
    client
      .from("pos_products")
      .select(
        "id,category_id,name_en,name_ar,description,price,qualifies_for_time,active,available,image_path,sort",
      )
      .eq("active", true)
      .order("sort")
      .order("name_en"),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  return {
    categories: categoriesResult.data,
    items: itemsResult.data,
  };
}

export async function listOrderVisits(): Promise<PosVisit[]> {
  return listOpenPosVisits();
}

export async function searchOrderCustomers(
  query: string,
): Promise<OrderCustomerCandidate[]> {
  const { data, error } = await getSupabaseClient().rpc(
    "search_order_customers",
    { p_query: query },
  );
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Customer search response was invalid.");
  return data.map((value) => {
    if (!isRecord(value)) throw new Error("Customer search response was invalid.");
    return {
      id: requiredString(value, "id"),
      code: requiredString(value, "code"),
      first_name: requiredString(value, "first_name"),
      last_name: requiredString(value, "last_name"),
    };
  });
}

export async function createOrder(input: {
  customerId: string;
  items: Array<{ menu_item_id: string; quantity: number; note: string }>;
  note: string;
  discount: number;
  discountReason: string;
}): Promise<NewOrderResult> {
  const { data, error } = await getSupabaseClient().rpc("create_order", {
    p_customer: input.customerId,
    p_items: input.items,
    p_note: input.note,
    p_discount: input.discount,
    p_discount_reason: input.discount > 0 ? input.discountReason : null,
  });
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Order response was invalid.");
  const items = data.items;
  if (!Array.isArray(items)) throw new Error("Order response was invalid.");
  return {
    order_id: requiredString(data, "order_id"),
    order_number: requiredNumber(data, "order_number"),
    subtotal: requiredNumber(data, "subtotal"),
    discount_total: requiredNumber(data, "discount_total"),
    service_amount: requiredNumber(data, "service_amount"),
    tax_amount: requiredNumber(data, "tax_amount"),
    total: requiredNumber(data, "total"),
    currency: requiredString(data, "currency"),
    timer_restarted: data.timer_restarted === true,
    server_now: requiredString(data, "server_now"),
    items: items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Order response was invalid.");
      }
      const row = item as Record<string, Json | undefined>;
      return {
        name_en: requiredString(row, "name_en"),
        name_ar: requiredString(row, "name_ar"),
        quantity: requiredNumber(row, "quantity"),
        note: typeof row.note === "string" ? row.note : null,
      };
    }),
  };
}

export function getOrderItemImageUrl(path: string): string {
  return getSupabaseClient().storage.from("menu").getPublicUrl(path).data.publicUrl;
}
