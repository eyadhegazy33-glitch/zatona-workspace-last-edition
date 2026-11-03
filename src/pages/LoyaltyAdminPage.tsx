import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Gift, LoaderCircle, Pencil, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  adjustCustomerLoyaltyPoints,
  deleteLoyaltyReward,
  getLoyaltyAdminData,
  resolveLoyaltyRedemption,
  saveLoyaltyReward,
  setLoyaltyEarnRate,
  type LoyaltyAdminData,
  type LoyaltyReward,
} from "../services/customerLoyalty";

const rateSchema = z.object({
  rate: z.coerce.number().finite().min(0).max(1000),
});

const rewardSchema = z.object({
  nameEn: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().min(1).max(100),
  descriptionEn: z.string().max(500),
  descriptionAr: z.string().max(500),
  pointsCost: z.coerce.number().int().min(1).max(100000000),
  stockRemaining: z.number().int().nonnegative().nullable(),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(-100000).max(100000),
});

const adjustmentSchema = z.object({
  customerCode: z.string().trim().min(1).max(40),
  points: z.coerce.number().int().min(-1000000).max(1000000).refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(500),
});

const resolutionSchema = z.object({
  reason: z.string().trim().max(500),
});

type RateValues = z.output<typeof rateSchema>;
type RewardValues = z.output<typeof rewardSchema>;
type AdjustmentValues = z.output<typeof adjustmentSchema>;

const emptyReward: RewardValues = {
  nameEn: "",
  nameAr: "",
  descriptionEn: "",
  descriptionAr: "",
  pointsCost: 1,
  stockRemaining: null,
  isActive: true,
  sortOrder: 0,
};

export function LoyaltyAdminPage() {
  const { i18n, t } = useTranslation();
  const [data, setData] = useState<LoyaltyAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [savedRate, setSavedRate] = useState<number | null>(null);
  const [rateRefreshError, setRateRefreshError] = useState(false);
  const [savingReward, setSavingReward] = useState(false);
  const [deletingReward, setDeletingReward] = useState<string | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustmentResult, setAdjustmentResult] = useState<{
    points: number;
    balance: number;
  } | null>(null);
  const [adjustmentRefreshError, setAdjustmentRefreshError] = useState(false);
  const [busyRedemption, setBusyRedemption] = useState<string | null>(null);
  const [editingReward, setEditingReward] = useState<string | null>(null);
  const [stockInput, setStockInput] = useState("");
  const [resolutionReasons, setResolutionReasons] = useState<Record<string, string>>({});

  const {
    formState: { errors: rateErrors },
    handleSubmit: handleRateSubmit,
    register: registerRate,
    reset: resetRate,
  } = useForm<z.input<typeof rateSchema>, unknown, RateValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: { rate: 1 },
  });
  const {
    formState: { errors: rewardErrors },
    handleSubmit: handleRewardSubmit,
    register: registerReward,
    reset: resetReward,
    setValue: setRewardValue,
  } = useForm<z.input<typeof rewardSchema>, unknown, RewardValues>({
    resolver: zodResolver(rewardSchema),
    defaultValues: emptyReward,
  });
  const {
    formState: { errors: adjustmentErrors },
    handleSubmit: handleAdjustmentSubmit,
    register: registerAdjustment,
    reset: resetAdjustment,
  } = useForm<z.input<typeof adjustmentSchema>, unknown, AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { customerCode: "", points: 1, reason: "" },
  });

  const refresh = useCallback(async (): Promise<LoyaltyAdminData | null> => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await getLoyaltyAdminData();
      setData(result);
      resetRate({ rate: result.points_per_currency_unit });
      return result;
    } catch {
      setLoadError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [resetRate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRateSave = handleRateSubmit(async ({ rate }) => {
    setActionError(false);
    setSavedRate(null);
    setRateRefreshError(false);
    setSavingRate(true);
    try {
      await setLoyaltyEarnRate(rate);
      const refreshed = await refresh();
      setSavedRate(refreshed?.points_per_currency_unit ?? rate);
      setRateRefreshError(refreshed === null);
    } catch {
      setActionError(true);
    } finally {
      setSavingRate(false);
    }
  });

  const handleRewardSave = handleRewardSubmit(async (values) => {
    const parsed = rewardSchema.safeParse({
      ...values,
      stockRemaining: stockInput.trim() === "" ? null : Number(stockInput),
    });
    if (!parsed.success) {
      setActionError(true);
      return;
    }
    setActionError(false);
    setSavingReward(true);
    try {
      await saveLoyaltyReward({
        id: editingReward,
        ...parsed.data,
      });
      setEditingReward(null);
      setStockInput("");
      resetReward(emptyReward);
      await refresh();
    } catch {
      setActionError(true);
    } finally {
      setSavingReward(false);
    }
  });

  const handleEditReward = (reward: LoyaltyReward) => {
    setEditingReward(reward.id);
    setStockInput(reward.stock_remaining === null ? "" : String(reward.stock_remaining));
    setRewardValue("nameEn", reward.name_en);
    setRewardValue("nameAr", reward.name_ar);
    setRewardValue("descriptionEn", reward.description_en);
    setRewardValue("descriptionAr", reward.description_ar);
    setRewardValue("pointsCost", reward.points_cost);
    setRewardValue("isActive", reward.is_active);
    setRewardValue("sortOrder", reward.sort_order);
  };

  const handleDeleteReward = async (reward: LoyaltyReward) => {
    const rewardName = isArabic ? reward.name_ar : reward.name_en;
    if (!window.confirm(t("loyaltyAdmin.reward.deleteConfirm", { name: rewardName }))) {
      return;
    }
    setActionError(false);
    setDeletingReward(reward.id);
    try {
      await deleteLoyaltyReward(reward.id);
      if (editingReward === reward.id) {
        setEditingReward(null);
        setStockInput("");
        resetReward(emptyReward);
      }
      await refresh();
    } catch {
      setActionError(true);
    } finally {
      setDeletingReward(null);
    }
  };

  const handleAdjustment = handleAdjustmentSubmit(async (values) => {
    setActionError(false);
    setAdjustmentResult(null);
    setAdjustmentRefreshError(false);
    setSavingAdjustment(true);
    try {
      const balance = await adjustCustomerLoyaltyPoints(values);
      setAdjustmentResult({ points: values.points, balance });
      resetAdjustment({ customerCode: "", points: 1, reason: "" });
      if (!(await refresh())) setAdjustmentRefreshError(true);
    } catch {
      setActionError(true);
    } finally {
      setSavingAdjustment(false);
    }
  });

  const handleResolution = async (
    redemptionId: string,
    status: "fulfilled" | "rejected",
  ) => {
    const reason = resolutionReasons[redemptionId] ?? "";
    const parsed = resolutionSchema.safeParse({ reason });
    if (!parsed.success || (status === "rejected" && parsed.data.reason.trim().length < 3)) {
      setActionError(true);
      return;
    }
    setBusyRedemption(redemptionId);
    setActionError(false);
    try {
      await resolveLoyaltyRedemption({ redemptionId, status, reason: parsed.data.reason });
      await refresh();
    } catch {
      setActionError(true);
    } finally {
      setBusyRedemption(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="grid min-h-64 place-items-center" role="status">
        <LoaderCircle aria-label={t("loyaltyAdmin.loading")} className="animate-spin text-brand" size={32} />
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {t("loyaltyAdmin.errors.load")}
        </p>
        <button className="mt-3 font-semibold text-brand underline" onClick={() => void refresh()} type="button">
          {t("loyaltyAdmin.retry")}
        </button>
      </section>
    );
  }
  if (!data) return null;

  const isArabic = i18n.resolvedLanguage === "ar";
  const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950";
  const fieldLabelClass = "text-sm font-medium text-slate-700 dark:text-slate-300";

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <Sparkles aria-hidden="true" size={24} />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-white">{t("loyaltyAdmin.title")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("loyaltyAdmin.description")}</p>
        </div>
      </div>

      {actionError && (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {t("loyaltyAdmin.errors.action")}
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-bold text-ink dark:text-white">{t("loyaltyAdmin.earnRate.title")}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("loyaltyAdmin.earnRate.help")}</p>
        <form className="mt-4 flex flex-wrap items-end gap-3" noValidate onSubmit={(event) => void handleRateSave(event)}>
          <div className="w-full max-w-xs">
            <label className={fieldLabelClass} htmlFor="loyalty-rate">{t("loyaltyAdmin.earnRate.label")}</label>
            <input className={inputClass} id="loyalty-rate" max="1000" min="0" step="0.1" type="number" {...registerRate("rate")} />
            {rateErrors.rate && <p className="mt-1 text-sm text-red-600">{t("loyaltyAdmin.validation.rate")}</p>}
          </div>
          <button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={savingRate} type="submit">
            {savingRate ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Save aria-hidden="true" size={17} />}
            {t("loyaltyAdmin.save")}
          </button>
          {savedRate !== null && (
            <p className="w-full text-sm text-emerald-700 dark:text-emerald-300" role="status">
              {t("loyaltyAdmin.earnRate.saved", {
                rate: savedRate.toLocaleString(isArabic ? "ar" : "en"),
              })}
            </p>
          )}
          {rateRefreshError && (
            <p className="w-full text-sm text-amber-700 dark:text-amber-300" role="status">
              {t("loyaltyAdmin.earnRate.refreshError")}
            </p>
          )}
        </form>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink dark:text-white">
              <Gift aria-hidden="true" className="text-brand" size={20} />
              {editingReward ? t("loyaltyAdmin.reward.editTitle") : t("loyaltyAdmin.reward.newTitle")}
            </h2>
            {editingReward && (
              <button
                className="text-sm font-semibold text-brand underline"
                onClick={() => {
                  setEditingReward(null);
                  setStockInput("");
                  resetReward(emptyReward);
                }}
                type="button"
              >
                {t("loyaltyAdmin.reward.cancelEdit")}
              </button>
            )}
          </div>
          <form className="mt-4 space-y-3" noValidate onSubmit={(event) => void handleRewardSave(event)}>
            <label className={`block ${fieldLabelClass}`} htmlFor="reward-name-en">
              {t("loyaltyAdmin.reward.nameEn")}
              <input className={inputClass} id="reward-name-en" maxLength={100} {...registerReward("nameEn")} />
              {rewardErrors.nameEn && <span className="mt-1 block text-xs text-red-600">{t("loyaltyAdmin.validation.required")}</span>}
            </label>
            <label className={`block ${fieldLabelClass}`} htmlFor="reward-name-ar">
              {t("loyaltyAdmin.reward.nameAr")}
              <input className={inputClass} dir="rtl" id="reward-name-ar" maxLength={100} {...registerReward("nameAr")} />
              {rewardErrors.nameAr && <span className="mt-1 block text-xs text-red-600">{t("loyaltyAdmin.validation.required")}</span>}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`block ${fieldLabelClass}`} htmlFor="reward-description-en">
                {t("loyaltyAdmin.reward.descriptionEn")}
                <textarea className={`${inputClass} min-h-20 py-2`} id="reward-description-en" maxLength={500} {...registerReward("descriptionEn")} />
              </label>
              <label className={`block ${fieldLabelClass}`} htmlFor="reward-description-ar">
                {t("loyaltyAdmin.reward.descriptionAr")}
                <textarea className={`${inputClass} min-h-20 py-2`} dir="rtl" id="reward-description-ar" maxLength={500} {...registerReward("descriptionAr")} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`block ${fieldLabelClass}`} htmlFor="reward-cost">
                {t("loyaltyAdmin.reward.pointsCost")}
                <input className={inputClass} id="reward-cost" min="1" step="1" type="number" {...registerReward("pointsCost")} />
                {rewardErrors.pointsCost && <span className="mt-1 block text-xs text-red-600">{t("loyaltyAdmin.validation.pointsCost")}</span>}
              </label>
              <label className={`block ${fieldLabelClass}`} htmlFor="reward-stock">
                {t("loyaltyAdmin.reward.stock")}
                <input className={inputClass} id="reward-stock" min="0" step="1" type="number" value={stockInput} onChange={(event) => setStockInput(event.target.value)} />
                <span className="mt-1 block text-xs text-slate-500">{t("loyaltyAdmin.reward.unlimitedHelp")}</span>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`block ${fieldLabelClass}`} htmlFor="reward-sort">
                {t("loyaltyAdmin.reward.sortOrder")}
                <input className={inputClass} id="reward-sort" step="1" type="number" {...registerReward("sortOrder")} />
              </label>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium text-slate-700 dark:text-slate-300">
                <input className="size-4 accent-brand" type="checkbox" {...registerReward("isActive")} />
                {t("loyaltyAdmin.reward.active")}
              </label>
            </div>
            <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-60" disabled={savingReward} type="submit">
              {savingReward ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : editingReward ? <Save aria-hidden="true" size={17} /> : <Plus aria-hidden="true" size={17} />}
              {editingReward ? t("loyaltyAdmin.reward.saveChanges") : t("loyaltyAdmin.reward.create")}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="font-semibold text-ink dark:text-white">{t("loyaltyAdmin.reward.existing")}</h3>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {data.rewards.map((reward) => (
                <li className="flex items-center justify-between gap-3 py-3" key={reward.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink dark:text-white">{isArabic ? reward.name_ar : reward.name_en}</p>
                    <p className="text-xs text-slate-500">{t("loyaltyAdmin.reward.pointsCount", { count: reward.points_cost })} · {reward.is_active ? t("loyaltyAdmin.reward.enabled") : t("loyaltyAdmin.reward.disabled")}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button aria-label={t("loyaltyAdmin.reward.edit")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" onClick={() => handleEditReward(reward)} type="button">
                      <Pencil aria-hidden="true" size={15} />
                      {t("loyaltyAdmin.reward.edit")}
                    </button>
                    <button
                      aria-label={t("loyaltyAdmin.reward.delete")}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
                      disabled={deletingReward !== null}
                      onClick={() => void handleDeleteReward(reward)}
                      type="button"
                    >
                      {deletingReward === reward.id ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : <Trash2 aria-hidden="true" size={15} />}
                      {t(deletingReward === reward.id ? "loyaltyAdmin.reward.deleting" : "loyaltyAdmin.reward.delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-ink dark:text-white">{t("loyaltyAdmin.adjustment.title")}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("loyaltyAdmin.adjustment.help")}</p>
            <form className="mt-4 space-y-3" noValidate onSubmit={(event) => void handleAdjustment(event)}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={`block ${fieldLabelClass}`} htmlFor="adjust-customer">
                  {t("loyaltyAdmin.adjustment.customerCode")}
                  <input autoComplete="off" className={inputClass} id="adjust-customer" maxLength={40} {...registerAdjustment("customerCode")} />
                  {adjustmentErrors.customerCode && <span className="mt-1 block text-xs text-red-600">{t("loyaltyAdmin.validation.required")}</span>}
                </label>
                <label className={`block ${fieldLabelClass}`} htmlFor="adjust-points">
                  {t("loyaltyAdmin.adjustment.points")}
                  <input className={inputClass} id="adjust-points" max="1000000" min="-1000000" step="1" type="number" {...registerAdjustment("points")} />
                  {adjustmentErrors.points && <span className="mt-1 block text-xs text-red-600">{t("loyaltyAdmin.validation.points")}</span>}
                </label>
              </div>
              <label className={`block ${fieldLabelClass}`} htmlFor="adjust-reason">
                {t("loyaltyAdmin.adjustment.reason")}
                <textarea className={`${inputClass} min-h-20 py-2`} id="adjust-reason" maxLength={500} {...registerAdjustment("reason")} />
                {adjustmentErrors.reason && <span className="mt-1 block text-xs text-red-600">{t("loyaltyAdmin.validation.reason")}</span>}
              </label>
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={savingAdjustment} type="submit">
                {savingAdjustment ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Plus aria-hidden="true" size={17} />}
                {t("loyaltyAdmin.adjustment.submit")}
              </button>
              {adjustmentResult && (
                <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
                  {t("loyaltyAdmin.adjustment.success", {
                    points: adjustmentResult.points > 0
                      ? `+${adjustmentResult.points.toLocaleString(isArabic ? "ar" : "en")}`
                      : adjustmentResult.points.toLocaleString(isArabic ? "ar" : "en"),
                    balance: adjustmentResult.balance.toLocaleString(isArabic ? "ar" : "en"),
                  })}
                </p>
              )}
              {adjustmentRefreshError && (
                <p className="text-sm text-amber-700 dark:text-amber-300" role="status">
                  {t("loyaltyAdmin.adjustment.refreshError")}
                </p>
              )}
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-ink dark:text-white">{t("loyaltyAdmin.redemptions.title")}</h2>
            {data.redemptions.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("loyaltyAdmin.redemptions.empty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {data.redemptions.map((redemption) => {
                  const resolvePending = busyRedemption === redemption.id;
                  return (
                    <li className="py-4" key={redemption.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink dark:text-white">{isArabic ? redemption.reward_name_ar : redemption.reward_name_en}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            {redemption.customer_name} · <span className="font-mono">{redemption.customer_code}</span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{t("loyaltyAdmin.redemptions.points", { count: redemption.points_cost })} · {new Intl.DateTimeFormat(isArabic ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(redemption.requested_at))}</p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t("loyaltyAdmin.redemptions.pending")}</span>
                      </div>
                      <label className={`mt-3 block ${fieldLabelClass}`} htmlFor={`resolution-${redemption.id}`}>
                        {t("loyaltyAdmin.redemptions.rejectReason")}
                        <textarea
                          className={`${inputClass} min-h-16 py-2`}
                          id={`resolution-${redemption.id}`}
                          maxLength={500}
                          onChange={(event) => setResolutionReasons((current) => ({ ...current, [redemption.id]: event.target.value }))}
                          value={resolutionReasons[redemption.id] ?? ""}
                        />
                      </label>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={resolvePending} onClick={() => void handleResolution(redemption.id, "fulfilled")} type="button">
                          {resolvePending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Check aria-hidden="true" size={16} />}
                          {t("loyaltyAdmin.redemptions.fulfill")}
                        </button>
                        <button className="inline-flex min-h-10 items-center rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-60 dark:border-red-900 dark:text-red-300" disabled={resolvePending} onClick={() => void handleResolution(redemption.id, "rejected")} type="button">
                          {t("loyaltyAdmin.redemptions.reject")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
