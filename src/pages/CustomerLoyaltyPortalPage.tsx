import { useCallback, useEffect, useState } from "react";
import { Award, Gift, History, LogOut, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import {
  clearCustomerLoyaltyToken,
  getCustomerLoyaltyPortal,
  getCustomerLoyaltyToken,
  requestCustomerLoyaltyReward,
  type CustomerLoyaltyPortalData,
} from "../services/customerLoyalty";

function isSessionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "28000";
}

export function CustomerLoyaltyPortalPage() {
  const { i18n, t } = useTranslation();
  const [token] = useState(getCustomerLoyaltyToken);
  const [data, setData] = useState<CustomerLoyaltyPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busyReward, setBusyReward] = useState<string | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(false);
    try {
      setData(await getCustomerLoyaltyPortal(token));
    } catch (error) {
      if (isSessionError(error)) {
        await clearCustomerLoyaltyToken();
        setLoggedOut(true);
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleLogout = async () => {
    try {
      await clearCustomerLoyaltyToken();
    } catch {
      // The local token is cleared even if the server is temporarily unreachable.
    }
    setLoggedOut(true);
  };

  const handleRewardRequest = async (rewardId: string) => {
    if (!token || busyReward) return;
    setBusyReward(rewardId);
    setActionError(false);
    try {
      await requestCustomerLoyaltyReward(token, rewardId);
      await refresh();
    } catch {
      setActionError(true);
      await refresh();
    } finally {
      setBusyReward(null);
    }
  };

  if (!token || loggedOut) {
    return <Navigate replace to="/customer/login" />;
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-64 place-items-center" role="status">
        <LoaderCircle aria-label={t("customerLoyalty.loading")} className="animate-spin text-brand" size={32} />
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <p>{t("customerLoyalty.errors.load")}</p>
          <button className="mt-3 inline-flex items-center gap-2 font-semibold underline" onClick={() => void refresh()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            {t("customerLoyalty.refresh")}
          </button>
        </div>
      </section>
    );
  }

  if (!data) return null;
  const isArabic = i18n.resolvedLanguage === "ar";
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(isArabic ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
  const entryLabel = (entryType: string) => {
    const labels: Record<string, string> = {
      purchase: "customerLoyalty.history.purchase",
      purchase_void: "customerLoyalty.history.void",
      manual_adjustment: "customerLoyalty.history.adjustment",
      redemption_reserve: "customerLoyalty.history.redemption",
      redemption_refund: "customerLoyalty.history.refund",
    };
    return t(labels[entryType] ?? "customerLoyalty.history.other");
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-brand to-emerald-700 p-6 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-sm font-semibold text-white/80">{t("customerLoyalty.portal.greeting")}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{data.customer.name}</h1>
          <p className="mt-2 font-mono text-sm text-white/80" dir="ltr">{data.customer.code}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/15 px-5 py-4 text-center">
            <Award aria-hidden="true" className="mx-auto" size={25} />
            <p className="mt-1 text-3xl font-bold tabular-nums">{data.points.toLocaleString(isArabic ? "ar" : "en")}</p>
            <p className="text-xs font-medium text-white/80">{t("customerLoyalty.portal.points")}</p>
          </div>
          <button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/40 px-4 text-sm font-semibold hover:bg-white/10" onClick={() => void handleLogout()} type="button">
            <LogOut aria-hidden="true" size={17} />
            {t("customerLoyalty.portal.logout")}
          </button>
        </div>
      </header>

      {actionError && (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {t("customerLoyalty.errors.reward")}
        </p>
      )}
      {loadError && (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
          {t("customerLoyalty.errors.refresh")}
        </p>
      )}

      <section className="mt-7">
        <div className="mb-4 flex items-center gap-2">
          <Gift aria-hidden="true" className="text-brand" size={22} />
          <h2 className="text-xl font-bold text-ink dark:text-white">{t("customerLoyalty.portal.rewardsTitle")}</h2>
        </div>
        {data.rewards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <Sparkles aria-hidden="true" className="mx-auto mb-2" size={24} />
            {t("customerLoyalty.portal.noRewards")}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.rewards.map((reward) => (
              <article className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" key={reward.id}>
                <h3 className="text-lg font-bold text-ink dark:text-white">
                  {isArabic ? reward.name_ar : reward.name_en}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {(isArabic ? reward.description_ar : reward.description_en) || t("customerLoyalty.portal.noDescription")}
                </p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="font-semibold text-brand">
                    {reward.points_cost.toLocaleString(isArabic ? "ar" : "en")} {t("customerLoyalty.portal.points")}
                  </span>
                  {reward.stock_remaining !== null && (
                    <span className="text-xs text-slate-500">{t("customerLoyalty.portal.stock", { count: reward.stock_remaining })}</span>
                  )}
                </div>
                <button
                  className="mt-4 min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={data.points < reward.points_cost || busyReward !== null}
                  onClick={() => void handleRewardRequest(reward.id)}
                  type="button"
                >
                  {busyReward === reward.id ? t("customerLoyalty.portal.requesting") : t("customerLoyalty.portal.requestReward")}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <History aria-hidden="true" className="text-brand" size={20} />
            <h2 className="text-lg font-bold text-ink dark:text-white">{t("customerLoyalty.portal.historyTitle")}</h2>
          </div>
          {data.history.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("customerLoyalty.portal.noHistory")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.history.map((item) => (
                <li className="flex items-center justify-between gap-4 py-3 text-sm" key={item.id}>
                  <div>
                    <p className="font-semibold text-ink dark:text-white">{entryLabel(item.entry_type)}</p>
                    <time className="mt-1 block text-xs text-slate-500">{formatDate(item.created_at)}</time>
                  </div>
                  <span className={item.points > 0 ? "font-bold text-emerald-700 dark:text-emerald-300" : "font-bold text-red-700 dark:text-red-300"}>
                    {item.points > 0 ? "+" : ""}{item.points.toLocaleString(isArabic ? "ar" : "en")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <Gift aria-hidden="true" className="text-brand" size={20} />
            <h2 className="text-lg font-bold text-ink dark:text-white">{t("customerLoyalty.portal.redemptionsTitle")}</h2>
          </div>
          {data.redemptions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("customerLoyalty.portal.noRedemptions")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.redemptions.map((redemption) => (
                <li className="py-3" key={redemption.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink dark:text-white">
                        {isArabic ? redemption.reward_name_ar : redemption.reward_name_en}
                      </p>
                      <time className="mt-1 block text-xs text-slate-500">{formatDate(redemption.requested_at)}</time>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">
                      {t(`customerLoyalty.redemptionStatus.${redemption.status}`)}
                    </span>
                  </div>
                  {redemption.resolution_reason && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{redemption.resolution_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
