import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { Json } from "../lib/database.types";
import {
  defaultOperationalRulesSettings,
  getOperationalRulesSettings,
  updateSetting,
  type OperationalRuleKey,
  type OperationalRulesSettings,
} from "../services/settings";

const inputClassName =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const moneyField = (message: string) =>
  z.coerce
    .number()
    .finite(message)
    .min(0, message)
    .max(99_999_999.99, message)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      message,
    );

const rulesSchema = z.object({
  timerWindowMinutes: z.coerce
    .number()
    .int("settings.rules.validation.timerWindow")
    .min(10, "settings.rules.validation.timerWindow")
    .max(1440, "settings.rules.validation.timerWindow"),
  timerWarningMinutes: z.coerce
    .number()
    .int("settings.rules.validation.minutes")
    .min(0, "settings.rules.validation.minutes")
    .max(1440, "settings.rules.validation.minutes"),
  timerGraceMinutes: z.coerce
    .number()
    .int("settings.rules.validation.minutes")
    .min(0, "settings.rules.validation.minutes")
    .max(1440, "settings.rules.validation.minutes"),
  feeAmount: moneyField("settings.rules.validation.amount"),
  feeRepeats: z.boolean(),
  timerRestartOn: z.enum(["order_created", "order_paid"]),
  serviceChargePercent: z.coerce
    .number()
    .finite("settings.rules.validation.percent")
    .min(0, "settings.rules.validation.percent")
    .max(100, "settings.rules.validation.percent"),
  taxPercent: z.coerce
    .number()
    .finite("settings.rules.validation.percent")
    .min(0, "settings.rules.validation.percent")
    .max(100, "settings.rules.validation.percent"),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "settings.rules.validation.currency"),
  timeZone: z
    .string()
    .trim()
    .min(1, "settings.rules.validation.timeZone")
    .max(100, "settings.rules.validation.timeZone")
    .refine(isSupportedTimeZone, "settings.rules.validation.timeZone"),
  receiptPrefix: z
    .string()
    .max(20, "settings.rules.validation.receiptPrefix"),
  requireOpenShift: z.boolean(),
  cashDifferenceAlertAmount: moneyField("settings.rules.validation.amount"),
});

type RulesFormValues = z.output<typeof rulesSchema>;
type RulesFormInput = z.input<typeof rulesSchema>;
type UpdateGroup = {
  field: keyof OperationalRulesSettings;
  keys: OperationalRuleKey[];
};

const updateGroups: UpdateGroup[] = [
  {
    field: "timerWindowMinutes",
    keys: [
      "ops.timer_window_minutes",
      "ops.visit_duration_minutes",
      "ops.fee_interval_minutes",
    ],
  },
  {
    field: "timerWarningMinutes",
    keys: ["ops.timer_warning_minutes"],
  },
  {
    field: "timerGraceMinutes",
    keys: ["ops.timer_grace_minutes"],
  },
  {
    field: "feeAmount",
    keys: ["ops.overdue_fee", "ops.fee_amount"],
  },
  {
    field: "feeRepeats",
    keys: ["ops.fee_repeats"],
  },
  {
    field: "timerRestartOn",
    keys: ["ops.timer_restart_on", "ops.timer_reset_on"],
  },
  {
    field: "serviceChargePercent",
    keys: ["ops.service_charge_percent", "ops.service_percent"],
  },
  {
    field: "taxPercent",
    keys: ["ops.tax_percent"],
  },
  {
    field: "currencyCode",
    keys: ["ops.currency_code", "ops.currency"],
  },
  {
    field: "timeZone",
    keys: ["ops.time_zone", "ops.timezone"],
  },
  {
    field: "receiptPrefix",
    keys: ["ops.receipt_prefix"],
  },
  {
    field: "requireOpenShift",
    keys: ["ops.require_open_shift"],
  },
  {
    field: "cashDifferenceAlertAmount",
    keys: ["ops.cash_difference_alert_amount", "ops.cash_diff_alert"],
  },
];

export function SettingsRulesTab() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedValues, setSavedValues] = useState<OperationalRulesSettings>(
    defaultOperationalRulesSettings,
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RulesFormInput, unknown, RulesFormValues>({
    resolver: zodResolver(rulesSchema),
    defaultValues: defaultOperationalRulesSettings,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const settings = await getOperationalRulesSettings();
      setSavedValues(settings);
      reset(settings);
    } catch (cause) {
      setLoadError(getLoadErrorKey(cause));
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (values: RulesFormValues) => {
    if (saving) return;

    const changedGroups = updateGroups.filter(
      ({ field }) => values[field] !== savedValues[field],
    );
    if (changedGroups.length === 0) {
      setSaved(true);
      setError("");
      return;
    }

    if (
      changedGroups.some(({ field }) =>
        field === "feeAmount" || field === "timerWindowMinutes",
      ) &&
      !window.confirm(t("settings.rules.confirmImpact"))
    ) {
      return;
    }

    const updates = changedGroups.flatMap(({ field, keys }) =>
      keys.map((key) => [key, values[field]] as [OperationalRuleKey, Json]),
    );

    setSaving(true);
    setError("");
    setSaved(false);
    let completed = 0;
    try {
      for (const [key, value] of updates) {
        await updateSetting(key, value);
        completed += 1;
      }
      setSavedValues(values);
      reset(values);
      setLoadError("");
      setSaved(true);
    } catch (cause) {
      setError(
        completed > 0
          ? "settings.rules.errors.partialSave"
          : getSaveErrorKey(cause),
      );
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    setError("");
    setSaved(false);
    await refresh();
  };

  const fieldError = (key: keyof RulesFormValues) => {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  };

  return (
    <div className="mt-6 space-y-6">
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        {t("settings.rules.impactNote")}
      </p>

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p>{t(loadError)}</p>
          <button
            className="mt-2 font-semibold underline underline-offset-2"
            onClick={() => void refresh()}
            type="button"
          >
            {t("settings.actions.retry")}
          </button>
        </div>
      )}
      {error && (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t(error)}
        </p>
      )}
      {saved && (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {t("settings.rules.saved")}
        </p>
      )}

      <form
        className="space-y-6"
        noValidate
        onSubmit={handleSubmit(save)}
      >
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <h2 className="text-lg font-semibold text-ink dark:text-white">
            {t("settings.rules.timerTitle")}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RulesField
              error={fieldError("timerWindowMinutes")}
              help={t("settings.rules.help.timerWindow")}
              id="timerWindowMinutes"
              label={t("settings.rules.fields.timerWindow")}
            >
              <input
                {...register("timerWindowMinutes", { valueAsNumber: true })}
                aria-describedby="timerWindowMinutes-help"
                className={inputClassName}
                id="timerWindowMinutes"
                max={1440}
                min={10}
                step={1}
                type="number"
              />
            </RulesField>
            <RulesField
              error={fieldError("timerWarningMinutes")}
              help={t("settings.rules.help.timerWarning")}
              id="timerWarningMinutes"
              label={t("settings.rules.fields.timerWarning")}
            >
              <input
                {...register("timerWarningMinutes", { valueAsNumber: true })}
                aria-describedby="timerWarningMinutes-help"
                className={inputClassName}
                id="timerWarningMinutes"
                max={1440}
                min={0}
                step={1}
                type="number"
              />
            </RulesField>
            <RulesField
              error={fieldError("timerGraceMinutes")}
              help={t("settings.rules.help.timerGrace")}
              id="timerGraceMinutes"
              label={t("settings.rules.fields.timerGrace")}
            >
              <input
                {...register("timerGraceMinutes", { valueAsNumber: true })}
                aria-describedby="timerGraceMinutes-help"
                className={inputClassName}
                id="timerGraceMinutes"
                max={1440}
                min={0}
                step={1}
                type="number"
              />
            </RulesField>
            <RulesField
              error={fieldError("feeAmount")}
              help={t("settings.rules.help.feeAmount")}
              id="feeAmount"
              label={t("settings.rules.fields.feeAmount")}
            >
              <input
                {...register("feeAmount", { valueAsNumber: true })}
                aria-describedby="feeAmount-help"
                className={inputClassName}
                id="feeAmount"
                min={0}
                step="0.01"
                type="number"
              />
            </RulesField>
            <RulesField
              help={t("settings.rules.help.feeRepeats")}
              id="feeRepeats"
              label={t("settings.rules.fields.feeRepeats")}
            >
              <input
                {...register("feeRepeats")}
                aria-label={t("settings.rules.fields.feeRepeats")}
                aria-describedby="feeRepeats-help"
                className="peer sr-only"
                id="feeRepeats"
                role="switch"
                type="checkbox"
              />
              <label
                aria-hidden="true"
                className="relative mt-2 inline-flex h-6 w-11 cursor-pointer rounded-full bg-slate-300 transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5"
                htmlFor="feeRepeats"
              />
            </RulesField>
            <RulesField
              error={fieldError("timerRestartOn")}
              help={t("settings.rules.help.timerRestartOn")}
              id="timerRestartOn"
              label={t("settings.rules.fields.timerRestartOn")}
            >
              <select
                {...register("timerRestartOn")}
                aria-describedby="timerRestartOn-help"
                className={inputClassName}
                id="timerRestartOn"
              >
                <option value="order_created">
                  {t("settings.rules.options.orderCreated")}
                </option>
                <option value="order_paid">
                  {t("settings.rules.options.orderPaid")}
                </option>
              </select>
            </RulesField>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <h2 className="text-lg font-semibold text-ink dark:text-white">
            {t("settings.rules.receiptsTitle")}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RulesField
              error={fieldError("serviceChargePercent")}
              help={t("settings.rules.help.serviceCharge")}
              id="serviceChargePercent"
              label={t("settings.rules.fields.serviceCharge")}
            >
              <input
                {...register("serviceChargePercent", { valueAsNumber: true })}
                aria-describedby="serviceChargePercent-help"
                className={inputClassName}
                id="serviceChargePercent"
                max={100}
                min={0}
                step="0.01"
                type="number"
              />
            </RulesField>
            <RulesField
              error={fieldError("taxPercent")}
              help={t("settings.rules.help.tax")}
              id="taxPercent"
              label={t("settings.rules.fields.tax")}
            >
              <input
                {...register("taxPercent", { valueAsNumber: true })}
                aria-describedby="taxPercent-help"
                className={inputClassName}
                id="taxPercent"
                max={100}
                min={0}
                step="0.01"
                type="number"
              />
            </RulesField>
            <RulesField
              error={fieldError("currencyCode")}
              help={t("settings.rules.help.currencyCode")}
              id="currencyCode"
              label={t("settings.rules.fields.currencyCode")}
            >
              <input
                {...register("currencyCode")}
                aria-describedby="currencyCode-help"
                autoCapitalize="characters"
                className={inputClassName}
                id="currencyCode"
                maxLength={3}
                type="text"
              />
            </RulesField>
            <RulesField
              error={fieldError("timeZone")}
              help={t("settings.rules.help.timeZone")}
              id="timeZone"
              label={t("settings.rules.fields.timeZone")}
            >
              <input
                {...register("timeZone")}
                aria-describedby="timeZone-help"
                className={inputClassName}
                id="timeZone"
                maxLength={100}
                type="text"
              />
            </RulesField>
            <RulesField
              error={fieldError("receiptPrefix")}
              help={t("settings.rules.help.receiptPrefix")}
              id="receiptPrefix"
              label={t("settings.rules.fields.receiptPrefix")}
            >
              <input
                {...register("receiptPrefix")}
                aria-describedby="receiptPrefix-help"
                className={inputClassName}
                id="receiptPrefix"
                maxLength={20}
                type="text"
              />
            </RulesField>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          <h2 className="text-lg font-semibold text-ink dark:text-white">
            {t("settings.rules.shiftTitle")}
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <RulesField
              help={t("settings.rules.help.requireOpenShift")}
              id="requireOpenShift"
              label={t("settings.rules.fields.requireOpenShift")}
            >
              <input
                {...register("requireOpenShift")}
                aria-label={t("settings.rules.fields.requireOpenShift")}
                aria-describedby="requireOpenShift-help"
                className="peer sr-only"
                id="requireOpenShift"
                role="switch"
                type="checkbox"
              />
              <label
                aria-hidden="true"
                className="relative mt-2 inline-flex h-6 w-11 cursor-pointer rounded-full bg-slate-300 transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5"
                htmlFor="requireOpenShift"
              />
            </RulesField>
            <RulesField
              error={fieldError("cashDifferenceAlertAmount")}
              help={t("settings.rules.help.cashDifferenceAlert")}
              id="cashDifferenceAlertAmount"
              label={t("settings.rules.fields.cashDifferenceAlert")}
            >
              <input
                {...register("cashDifferenceAlertAmount", {
                  valueAsNumber: true,
                })}
                aria-describedby="cashDifferenceAlertAmount-help"
                className={inputClassName}
                id="cashDifferenceAlertAmount"
                min={0}
                step="0.01"
                type="number"
              />
            </RulesField>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={saving || loading}
            onClick={() => void discard()}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={16} />
            {t("settings.actions.discard")}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={saving || loading || Boolean(loadError)}
            type="submit"
          >
            {saving ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                size={16}
              />
            ) : (
              <Save aria-hidden="true" size={16} />
            )}
            {saving
              ? t("settings.actions.saving")
              : t("settings.rules.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function RulesField({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label
        className="block text-sm font-medium text-slate-700 dark:text-slate-200"
        htmlFor={id}
      >
        {label}
      </label>
      {children}
      <p
        className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400"
        id={`${id}-help`}
      >
        {help}
      </p>
      {error && (
        <p
          className="mt-1 text-xs text-red-600 dark:text-red-300"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch (cause) {
    if (cause instanceof RangeError) return false;
    throw cause;
  }
}

function getLoadErrorKey(cause: unknown): string {
  if (
    cause instanceof Error &&
    cause.message === "settings.rules.errors.invalidStoredValue"
  ) {
    return cause.message;
  }
  return "settings.rules.errors.load";
}

function getSaveErrorKey(cause: unknown): string {
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string" &&
    cause.message.includes("currency cannot be changed while a shift is open")
  ) {
    return "settings.rules.errors.currencyLocked";
  }
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "42501"
  ) {
    return "settings.rules.errors.permission";
  }
  return "settings.rules.errors.save";
}
