import { Check, Gift, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getLoyaltyAdminData,
  resolveLoyaltyRedemption,
  type LoyaltyAdminRedemption,
} from "../services/customerLoyalty";

export function LoyaltyRedemptionsPage() {
  const { i18n, t } = useTranslation();
  const [redemptions, setRedemptions] = useState<LoyaltyAdminRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [selectedRedemption, setSelectedRedemption] =
    useState<LoyaltyAdminRedemption | null>(null);
  const [saving, setSaving] = useState(false);
  const isArabic = i18n.resolvedLanguage === "ar";

  const refresh = useCallback(async () => {
    setLoadError(false);
    try {
      const data = await getLoyaltyAdminData();
      setRedemptions(data.redemptions);
      return true;
    } catch {
      setLoadError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmFulfillment = async () => {
    if (!selectedRedemption || saving) return;
    setSaving(true);
    setActionError(false);
    setRefreshError(false);
    try {
      await resolveLoyaltyRedemption({
        redemptionId: selectedRedemption.id,
        status: "fulfilled",
        reason: "",
      });
      setRedemptions((current) =>
        current.filter((redemption) => redemption.id !== selectedRedemption.id),
      );
      setSelectedRedemption(null);
      if (!(await refresh())) setRefreshError(true);
    } catch {
      setActionError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center" role="status">
        <LoaderCircle
          aria-label={t("loyaltyFulfillment.loading")}
          className="animate-spin text-brand"
          size={32}
        />
      </div>
    );
  }

  if (loadError && redemptions.length === 0) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t("loyaltyFulfillment.errors.load")}
        </p>
        <button
          className="mt-3 font-semibold text-brand underline"
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          type="button"
        >
          {t("loyaltyFulfillment.retry")}
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Gift aria-hidden="true" size={24} />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-ink dark:text-white">
              {t("loyaltyFulfillment.title")}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t("loyaltyFulfillment.description")}
            </p>
          </div>
        </div>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-ink dark:border-slate-700 dark:text-slate-100"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          type="button"
        >
          {loading ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
          ) : (
            <RefreshCw aria-hidden="true" size={16} />
          )}
          {t("loyaltyFulfillment.refresh")}
        </button>
      </div>

      {actionError && (
        <p
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t("loyaltyFulfillment.errors.action")}
        </p>
      )}
      {refreshError && (
        <p
          className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
        >
          {t("loyaltyFulfillment.errors.refresh")}
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-bold text-ink dark:text-white">
          {t("loyaltyAdmin.redemptions.title")}
          <span className="ms-2 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {redemptions.length}
          </span>
        </h2>
        {redemptions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            {t("loyaltyAdmin.redemptions.empty")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {redemptions.map((redemption) => (
              <li
                className="flex flex-wrap items-center justify-between gap-4 py-4"
                key={redemption.id}
              >
                <div>
                  <p className="font-semibold text-ink dark:text-white">
                    {redemption.customer_first_name}
                  </p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                    {isArabic ? redemption.reward_name_ar : redemption.reward_name_en}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("loyaltyAdmin.redemptions.points", {
                      count: redemption.points_cost,
                    })}
                    {" · "}
                    {new Intl.DateTimeFormat(isArabic ? "ar" : "en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(redemption.requested_at))}
                  </p>
                </div>
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={saving}
                  onClick={() => {
                    setActionError(false);
                    setSelectedRedemption(redemption);
                  }}
                  type="button"
                >
                  <Check aria-hidden="true" size={16} />
                  {t("loyaltyAdmin.redemptions.fulfill")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedRedemption && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <section
            aria-labelledby="loyalty-fulfillment-confirm-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="text-lg font-semibold text-ink dark:text-white"
                id="loyalty-fulfillment-confirm-title"
              >
                {t("loyaltyFulfillment.confirmTitle")}
              </h2>
              <button
                aria-label={t("loyaltyFulfillment.cancel")}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={saving}
                onClick={() => setSelectedRedemption(null)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
              {t("loyaltyFulfillment.confirmMessage")}
            </p>
            <dl className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
              <div>
                <dt className="text-xs text-slate-500">
                  {t("loyaltyFulfillment.customer")}
                </dt>
                <dd className="font-semibold text-ink dark:text-white">
                  {selectedRedemption.customer_first_name}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">
                  {t("loyaltyFulfillment.reward")}
                </dt>
                <dd className="font-semibold text-ink dark:text-white">
                  {isArabic
                    ? selectedRedemption.reward_name_ar
                    : selectedRedemption.reward_name_en}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                disabled={saving}
                onClick={() => setSelectedRedemption(null)}
                type="button"
              >
                {t("loyaltyFulfillment.cancel")}
              </button>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
                disabled={saving}
                onClick={() => void confirmFulfillment()}
                type="button"
              >
                {saving && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={16}
                  />
                )}
                {t("loyaltyFulfillment.confirm")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
