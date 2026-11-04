import { getSupabaseClient } from "../lib/supabase";
import type { Json } from "../lib/database.types";

const sessionStorageKey = "zatona.customer-loyalty-session";

export type LoyaltyReward = {
  id: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  points_cost: number;
  stock_remaining: number | null;
  is_active: boolean;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  minimum_checkins: number;
  inventory_item_id: string | null;
  inventory_item_name: string | null;
  inventory_unit: string | null;
  inventory_quantity: number | null;
};

export type CustomerLoyaltyReward = LoyaltyReward & {
  customer_checkins: number;
  inventory_remaining: number | null;
  can_redeem: boolean;
  availability_reason: "available" | "not_started" | "expired" | "visits_required" | "out_of_stock" | "points_required";
};

export type LoyaltyInventoryItem = {
  id: string;
  name: string;
  unit: string;
  qty: number;
};

export type LoyaltyHistoryItem = {
  id: number;
  points: number;
  entry_type: string;
  created_at: string;
};

export type LoyaltyRedemption = {
  id: string;
  reward_name_en: string;
  reward_name_ar: string;
  points_cost: number;
  status: "requested" | "fulfilled" | "rejected";
  requested_at: string;
  resolution_reason: string | null;
};

export type CustomerLoyaltyPortalData = {
  customer: { id: string; code: string; name: string };
  points: number;
  rewards: CustomerLoyaltyReward[];
  history: LoyaltyHistoryItem[];
  redemptions: LoyaltyRedemption[];
};

export type LoyaltyAdminRedemption = LoyaltyRedemption & {
  customer_id: string;
  customer_first_name: string;
  customer_name: string;
  customer_code: string;
  reward_id: string;
  reserved_inventory_item_name: string | null;
  reserved_inventory_quantity: number | null;
  reserved_inventory_unit: string | null;
};

export type LoyaltyAdminData = {
  points_per_currency_unit: number;
  rewards: LoyaltyReward[];
  inventory_items: LoyaltyInventoryItem[];
  redemptions: LoyaltyAdminRedemption[];
};

function isRecord(
  value: Json | null | undefined,
): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(
  value: Json | undefined,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`Loyalty response field "${field}" was invalid.`);
  }
  return value;
}

function requiredNumber(value: Json | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Loyalty response field "${field}" was invalid.`);
  }
  return value;
}

function optionalNumber(value: Json | undefined, field: string): number | null {
  if (value === null) return null;
  return requiredNumber(value, field);
}

function optionalString(value: Json | undefined, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function parseReward(value: Json): LoyaltyReward {
  if (!isRecord(value)) throw new Error("Loyalty reward response was invalid.");
  return {
    id: requiredString(value.id, "reward.id"),
    name_en: requiredString(value.name_en, "reward.name_en"),
    name_ar: requiredString(value.name_ar, "reward.name_ar"),
    description_en: requiredString(value.description_en, "reward.description_en"),
    description_ar: requiredString(value.description_ar, "reward.description_ar"),
    points_cost: requiredNumber(value.points_cost, "reward.points_cost"),
    stock_remaining: optionalNumber(value.stock_remaining, "reward.stock_remaining"),
    is_active: value.is_active === true,
    sort_order: requiredNumber(value.sort_order, "reward.sort_order"),
    starts_at: optionalString(value.starts_at, "reward.starts_at"),
    ends_at: optionalString(value.ends_at, "reward.ends_at"),
    minimum_checkins: requiredNumber(value.minimum_checkins, "reward.minimum_checkins"),
    inventory_item_id: optionalString(value.inventory_item_id, "reward.inventory_item_id"),
    inventory_item_name: optionalString(value.inventory_item_name, "reward.inventory_item_name"),
    inventory_unit: optionalString(value.inventory_unit, "reward.inventory_unit"),
    inventory_quantity: optionalNumber(value.inventory_quantity, "reward.inventory_quantity"),
  };
}

function parseCustomerReward(value: Json): CustomerLoyaltyReward {
  if (!isRecord(value)) throw new Error("Loyalty reward response was invalid.");
  const reason = requiredString(value.availability_reason, "reward.availability_reason");
  if (
    reason !== "available" &&
    reason !== "not_started" &&
    reason !== "expired" &&
    reason !== "visits_required" &&
    reason !== "out_of_stock" &&
    reason !== "points_required"
  ) {
    throw new Error("Loyalty reward availability was invalid.");
  }
  return {
    ...parseReward(value),
    customer_checkins: requiredNumber(value.customer_checkins, "reward.customer_checkins"),
    inventory_remaining: optionalNumber(value.inventory_remaining, "reward.inventory_remaining"),
    can_redeem: value.can_redeem === true,
    availability_reason: reason,
  };
}

function parseInventoryItem(value: Json): LoyaltyInventoryItem {
  if (!isRecord(value)) throw new Error("Loyalty inventory item response was invalid.");
  return {
    id: requiredString(value.id, "inventory_item.id"),
    name: requiredString(value.name, "inventory_item.name"),
    unit: requiredString(value.unit, "inventory_item.unit"),
    qty: requiredNumber(value.qty, "inventory_item.qty"),
  };
}

function parseHistory(value: Json): LoyaltyHistoryItem {
  if (!isRecord(value)) throw new Error("Loyalty history response was invalid.");
  return {
    id: requiredNumber(value.id, "history.id"),
    points: requiredNumber(value.points, "history.points"),
    entry_type: requiredString(value.entry_type, "history.entry_type"),
    created_at: requiredString(value.created_at, "history.created_at"),
  };
}

function parseRedemption(value: Json): LoyaltyRedemption {
  if (!isRecord(value)) throw new Error("Loyalty redemption response was invalid.");
  const status = requiredString(value.status, "redemption.status");
  if (status !== "requested" && status !== "fulfilled" && status !== "rejected") {
    throw new Error("Loyalty redemption status was invalid.");
  }
  return {
    id: requiredString(value.id, "redemption.id"),
    reward_name_en: requiredString(value.reward_name_en, "redemption.reward_name_en"),
    reward_name_ar: requiredString(value.reward_name_ar, "redemption.reward_name_ar"),
    points_cost: requiredNumber(value.points_cost, "redemption.points_cost"),
    status,
    requested_at: requiredString(value.requested_at, "redemption.requested_at"),
    resolution_reason:
      typeof value.resolution_reason === "string" ? value.resolution_reason : null,
  };
}

function parseArray<T>(
  value: Json | undefined,
  parser: (item: Json) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error("Loyalty list response was invalid.");
  return value.map(parser);
}

export async function customerLoyaltyLogin(input: {
  customerCode: string;
  phone: string;
  pin: string;
}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("customer_loyalty_login", {
    p_customer_code: input.customerCode.trim(),
    p_phone: input.phone.trim(),
    p_pin: input.pin,
  });
  if (error) throw error;
  if (isRecord(data) && data.error === "invalid_credentials") {
    throw new Error("Customer sign-in details could not be verified.");
  }
  if (!isRecord(data) || typeof data.token !== "string" || data.token.length !== 64) {
    throw new Error("Customer sign-in response was invalid.");
  }
  return data.token;
}

export function storeCustomerLoyaltyToken(token: string): void {
  window.sessionStorage.setItem(sessionStorageKey, token);
}

export function getCustomerLoyaltyToken(): string | null {
  try {
    const token = window.sessionStorage.getItem(sessionStorageKey);
    return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export async function clearCustomerLoyaltyToken(): Promise<void> {
  const token = getCustomerLoyaltyToken();
  try {
    window.sessionStorage.removeItem(sessionStorageKey);
  } catch {
    // The server-side session still expires after inactivity.
  }
  if (token) {
    const { error } = await getSupabaseClient().rpc("customer_loyalty_logout", {
      p_token: token,
    });
    if (error) throw error;
  }
}

export async function getCustomerLoyaltyPortal(
  token: string,
): Promise<CustomerLoyaltyPortalData> {
  const { data, error } = await getSupabaseClient().rpc(
    "get_customer_loyalty_portal",
    { p_token: token },
  );
  if (error) throw error;
  if (!isRecord(data) || !isRecord(data.customer)) {
    throw new Error("Customer loyalty response was invalid.");
  }
  return {
    customer: {
      id: requiredString(data.customer.id, "customer.id"),
      code: requiredString(data.customer.code, "customer.code"),
      name: requiredString(data.customer.name, "customer.name"),
    },
    points: requiredNumber(data.points, "points"),
    rewards: parseArray(data.rewards, parseCustomerReward),
    history: parseArray(data.history, parseHistory),
    redemptions: parseArray(data.redemptions, parseRedemption),
  };
}

export async function requestCustomerLoyaltyReward(
  token: string,
  rewardId: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc(
    "request_customer_loyalty_reward",
    { p_token: token, p_reward: rewardId },
  );
  if (error) throw error;
}

export async function getLoyaltyAdminData(): Promise<LoyaltyAdminData> {
  const { data, error } = await getSupabaseClient().rpc("get_loyalty_admin_data");
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Loyalty administration response was invalid.");
  const redemptions = parseArray(data.redemptions, (item) => {
    if (!isRecord(item)) throw new Error("Loyalty redemption response was invalid.");
    const customerName = requiredString(item.customer_name, "redemption.customer_name");
    const customerFirstName =
      typeof item.customer_first_name === "string"
        ? item.customer_first_name
        : customerName.trim().split(/\s+/, 1)[0];
    if (!customerFirstName) {
      throw new Error("Loyalty redemption customer name was invalid.");
    }
    return {
      ...parseRedemption(item),
      customer_id: requiredString(item.customer_id, "redemption.customer_id"),
      customer_first_name: customerFirstName,
      customer_name: customerName,
      customer_code: requiredString(item.customer_code, "redemption.customer_code"),
      reward_id: requiredString(item.reward_id, "redemption.reward_id"),
      reserved_inventory_item_name: optionalString(
        item.reserved_inventory_item_name,
        "redemption.reserved_inventory_item_name",
      ),
      reserved_inventory_quantity: optionalNumber(
        item.reserved_inventory_quantity,
        "redemption.reserved_inventory_quantity",
      ),
      reserved_inventory_unit: optionalString(
        item.reserved_inventory_unit,
        "redemption.reserved_inventory_unit",
      ),
    };
  });
  return {
    points_per_currency_unit: requiredNumber(
      data.points_per_currency_unit,
      "points_per_currency_unit",
    ),
    rewards: parseArray(data.rewards, parseReward),
    inventory_items: parseArray(data.inventory_items, parseInventoryItem),
    redemptions,
  };
}

export async function setCustomerLoyaltyPin(
  customerId: string,
  pin: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_customer_loyalty_pin", {
    p_customer: customerId,
    p_pin: pin,
  });
  if (error) throw error;
}

export async function setLoyaltyEarnRate(rate: number): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_loyalty_earn_rate", {
    p_points_per_currency_unit: rate,
  });
  if (error) throw error;
}

export async function saveLoyaltyReward(input: {
  id: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  pointsCost: number;
  stockRemaining: number | null;
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  minimumCheckins: number;
  inventoryItemId: string | null;
  inventoryQuantity: number | null;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("save_loyalty_reward_config", {
    p_id: input.id,
    p_name_en: input.nameEn,
    p_name_ar: input.nameAr,
    p_description_en: input.descriptionEn,
    p_description_ar: input.descriptionAr,
    p_points_cost: input.pointsCost,
    p_stock_remaining: input.stockRemaining,
    p_is_active: input.isActive,
    p_sort_order: input.sortOrder,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_minimum_checkins: input.minimumCheckins,
    p_inventory_item: input.inventoryItemId,
    p_inventory_quantity: input.inventoryQuantity,
  });
  if (error) throw error;
}

export async function deleteLoyaltyReward(rewardId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("delete_loyalty_reward", {
    p_reward: rewardId,
  });
  if (error) throw error;
}

export async function adjustCustomerLoyaltyPoints(input: {
  customerCode: string;
  points: number;
  reason: string;
}): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("adjust_customer_loyalty_points", {
    p_customer_code: input.customerCode,
    p_points: input.points,
    p_reason: input.reason,
  });
  if (error) throw error;
  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    throw new Error("Loyalty adjustment response was invalid.");
  }
  return data;
}

export async function resolveLoyaltyRedemption(input: {
  redemptionId: string;
  status: "fulfilled" | "rejected";
  reason: string;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("resolve_loyalty_redemption", {
    p_redemption: input.redemptionId,
    p_status: input.status,
    p_reason: input.reason,
  });
  if (error) throw error;
}
