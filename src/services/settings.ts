import type { Json } from "../lib/database.types";
import { getSupabaseClient } from "../lib/supabase";

export type BrandingSettings = {
  workspaceName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

export const defaultBrandingSettings: BrandingSettings = {
  workspaceName: "elzatona",
  logoUrl: null,
  primaryColor: "#315c45",
  secondaryColor: "#202721",
};

const settingKeys = [
  "workspace_name",
  "logo_url",
  "primary_color",
  "secondary_color",
] as const;

type SettingKey = (typeof settingKeys)[number];
type SettingsRow = { key: SettingKey; value: Json };

export const operationalRuleKeys = [
  "ops.timer_window_minutes",
  "ops.timer_warning_minutes",
  "ops.timer_grace_minutes",
  "ops.overdue_fee",
  "ops.fee_repeats",
  "ops.timer_restart_on",
  "ops.service_charge_percent",
  "ops.tax_percent",
  "ops.currency_code",
  "ops.time_zone",
  "ops.receipt_prefix",
  "ops.require_open_shift",
  "ops.cash_difference_alert_amount",
  "ops.visit_duration_minutes",
  "ops.fee_interval_minutes",
  "ops.fee_amount",
  "ops.timer_reset_on",
  "ops.service_percent",
  "ops.currency",
  "ops.timezone",
  "ops.cash_diff_alert",
] as const;

export type OperationalRuleKey = (typeof operationalRuleKeys)[number];
export type OperationalRulesSettings = {
  timerWindowMinutes: number;
  timerWarningMinutes: number;
  timerGraceMinutes: number;
  feeAmount: number;
  feeRepeats: boolean;
  timerRestartOn: "order_created" | "order_paid";
  serviceChargePercent: number;
  taxPercent: number;
  currencyCode: string;
  timeZone: string;
  receiptPrefix: string;
  requireOpenShift: boolean;
  cashDifferenceAlertAmount: number;
};

export const defaultOperationalRulesSettings: OperationalRulesSettings = {
  timerWindowMinutes: 180,
  timerWarningMinutes: 15,
  timerGraceMinutes: 0,
  feeAmount: 0,
  feeRepeats: true,
  timerRestartOn: "order_paid",
  serviceChargePercent: 0,
  taxPercent: 0,
  currencyCode: "EGP",
  timeZone: "Africa/Cairo",
  receiptPrefix: "R-",
  requireOpenShift: false,
  cashDifferenceAlertAmount: 0,
};

type OperationalSettingRow = { key: string; value: Json };

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const { data, error } = await getSupabaseClient()
    .from("settings")
    .select("key, value")
    .in("key", [...settingKeys]);

  if (error) throw error;

  const values = new Map((data as SettingsRow[]).map((row) => [row.key, row.value]));
  const workspaceName = values.get("workspace_name");
  const logoUrl = values.get("logo_url");
  const primaryColor = values.get("primary_color");
  const secondaryColor = values.get("secondary_color");

  return {
    workspaceName:
      typeof workspaceName === "string" && workspaceName.trim()
        ? workspaceName.trim()
        : defaultBrandingSettings.workspaceName,
    logoUrl: typeof logoUrl === "string" && logoUrl ? logoUrl : null,
    primaryColor:
      typeof primaryColor === "string" && isHexColor(primaryColor)
        ? primaryColor
        : defaultBrandingSettings.primaryColor,
    secondaryColor:
      typeof secondaryColor === "string" && isHexColor(secondaryColor)
        ? secondaryColor
        : defaultBrandingSettings.secondaryColor,
  };
}

export async function getOperationalRulesSettings(): Promise<OperationalRulesSettings> {
  const { data, error } = await getSupabaseClient()
    .from("settings")
    .select("key, value")
    .like("key", "ops.%");

  if (error) throw error;

  const values = new Map(
    (data as OperationalSettingRow[]).map((row) => [row.key, row.value]),
  );
  const settings: OperationalRulesSettings = {
    timerWindowMinutes: readNumber(
      values,
      ["ops.timer_window_minutes", "ops.visit_duration_minutes"],
      defaultOperationalRulesSettings.timerWindowMinutes,
    ),
    timerWarningMinutes: readNumber(
      values,
      ["ops.timer_warning_minutes"],
      defaultOperationalRulesSettings.timerWarningMinutes,
    ),
    timerGraceMinutes: readNumber(
      values,
      ["ops.timer_grace_minutes"],
      defaultOperationalRulesSettings.timerGraceMinutes,
    ),
    feeAmount: readNumber(
      values,
      ["ops.overdue_fee", "ops.fee_amount"],
      defaultOperationalRulesSettings.feeAmount,
    ),
    feeRepeats: readBoolean(
      values,
      ["ops.fee_repeats"],
      defaultOperationalRulesSettings.feeRepeats,
    ),
    timerRestartOn: readTimerRestartOn(values),
    serviceChargePercent: readNumber(
      values,
      ["ops.service_charge_percent", "ops.service_percent"],
      defaultOperationalRulesSettings.serviceChargePercent,
    ),
    taxPercent: readNumber(
      values,
      ["ops.tax_percent"],
      defaultOperationalRulesSettings.taxPercent,
    ),
    currencyCode: readString(
      values,
      ["ops.currency_code", "ops.currency"],
      defaultOperationalRulesSettings.currencyCode,
    ),
    timeZone: readString(
      values,
      ["ops.time_zone", "ops.timezone"],
      defaultOperationalRulesSettings.timeZone,
    ),
    receiptPrefix: readString(
      values,
      ["ops.receipt_prefix"],
      defaultOperationalRulesSettings.receiptPrefix,
    ),
    requireOpenShift: readBoolean(
      values,
      ["ops.require_open_shift"],
      defaultOperationalRulesSettings.requireOpenShift,
    ),
    cashDifferenceAlertAmount: readNumber(
      values,
      ["ops.cash_difference_alert_amount", "ops.cash_diff_alert"],
      defaultOperationalRulesSettings.cashDifferenceAlertAmount,
    ),
  };

  return settings;
}

export type ReceiptDisplaySettings = {
  currencyCode: string;
  timeZone: string;
  receiptPrefix: string;
  footerText: string;
};

export async function getReceiptDisplaySettings(): Promise<ReceiptDisplaySettings> {
  const { data, error } = await getSupabaseClient()
    .from("settings")
    .select("key, value")
    .in("key", [
      "ops.currency_code",
      "ops.currency",
      "ops.time_zone",
      "ops.timezone",
      "ops.receipt_prefix",
      "ops.receipt_footer_text",
      "ops.receipt_footer",
    ]);

  if (error) throw error;
  const values = new Map(
    (data as OperationalSettingRow[]).map((row) => [row.key, row.value]),
  );
  const settings = {
    currencyCode: readString(
      values,
      ["ops.currency_code", "ops.currency"],
      defaultOperationalRulesSettings.currencyCode,
    ),
    timeZone: readString(
      values,
      ["ops.time_zone", "ops.timezone"],
      defaultOperationalRulesSettings.timeZone,
    ),
    receiptPrefix: readString(
      values,
      ["ops.receipt_prefix"],
      defaultOperationalRulesSettings.receiptPrefix,
    ),
    footerText: readString(
      values,
      ["ops.receipt_footer_text", "ops.receipt_footer"],
      "",
    ),
  };
  if (!/^[A-Z]{3}$/.test(settings.currencyCode)) {
    throw new Error("settings.errors.invalidStoredValue");
  }
  new Intl.DateTimeFormat("en", { timeZone: settings.timeZone });
  return settings;
}

function readSetting(
  values: Map<string, Json>,
  keys: string[],
): Json | undefined {
  for (const key of keys) {
    const value = values.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readNumber(
  values: Map<string, Json>,
  keys: string[],
  fallback: number,
): number {
  const value = readSetting(values, keys);
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("settings.errors.invalidStoredValue");
  }
  return value;
}

function readBoolean(
  values: Map<string, Json>,
  keys: string[],
  fallback: boolean,
): boolean {
  const value = readSetting(values, keys);
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error("settings.errors.invalidStoredValue");
  }
  return value;
}

function readString(
  values: Map<string, Json>,
  keys: string[],
  fallback: string,
): string {
  const value = readSetting(values, keys);
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new Error("settings.errors.invalidStoredValue");
  }
  return value;
}

function readTimerRestartOn(
  values: Map<string, Json>,
): OperationalRulesSettings["timerRestartOn"] {
  const value = readSetting(values, [
    "ops.timer_reset_on",
    "ops.timer_restart_on",
  ]);
  if (value === undefined) return defaultOperationalRulesSettings.timerRestartOn;
  if (value === "order_created" || value === "order_paid") return value;
  throw new Error("settings.errors.invalidStoredValue");
}

export async function updateSetting(
  key: SettingKey | OperationalRuleKey,
  value: Json,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_setting", {
    p_key: key,
    p_value: value,
  });
  if (error) throw error;
}

export async function uploadBrandingImage(file: File): Promise<string> {
  validateBrandingImage(file);
  const extensionByMimeType: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const extension = extensionByMimeType[file.type];
  if (!extension) throw new Error("settings.errors.invalidImage");
  const path = `logos/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await getSupabaseClient()
    .storage.from("branding")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  const { data: urlData } = getSupabaseClient()
    .storage.from("branding")
    .getPublicUrl(data.path);
  return urlData.publicUrl;
}

export async function removeBrandingImage(url: string): Promise<void> {
  const marker = "/storage/v1/object/public/branding/";
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return;
  const path = decodeURIComponent(url.slice(markerIndex + marker.length));
  const { error } = await getSupabaseClient().storage.from("branding").remove([path]);
  if (error) throw error;
}

export function validateBrandingImage(file: File): void {
  const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("settings.errors.imageType");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("settings.errors.imageSize");
  }
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
