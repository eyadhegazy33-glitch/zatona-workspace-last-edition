import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock3, LoaderCircle } from "lucide-react";
import { getAlertShiftSession } from "../services/alerts";

type SessionDetails = NonNullable<Awaited<ReturnType<typeof getAlertShiftSession>>>;

export function AlertShiftSessionPage() {
  const { i18n, t } = useTranslation();
  const { sessionId = "" } = useParams();
  const [session, setSession] = useState<SessionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(false);
    try {
      setSession(await getAlertShiftSession(sessionId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionId]);

  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : t("alerts.shiftSession.open");
  const formatMoney = (value: number | null) => value === null
    ? t("alerts.shiftSession.notRecorded")
    : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink dark:text-white"><Clock3 className="text-brand" size={23} />{t("alerts.shiftSession.title")}</h1>
      {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-slate-500" role="status"><LoaderCircle className="animate-spin" size={17} />{t("alerts.loading")}</p> : error ? (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("alerts.errors.related")} <button className="ms-2 font-semibold underline" onClick={() => void refresh()} type="button">{t("alerts.actions.retry")}</button></p>
      ) : !session ? (
        <p className="mt-6 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">{t("alerts.shiftSession.notFound")}</p>
      ) : (
        <dl className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.employee")}</dt><dd className="mt-1 font-medium text-ink dark:text-white">{session.employee_name || t("alerts.shiftSession.unknown")}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.shift")}</dt><dd className="mt-1 font-medium text-ink dark:text-white">{session.shift_name || t("alerts.shiftSession.unknown")}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.opened")}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{formatDate(session.opened_at)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.closed")}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{formatDate(session.closed_at)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.openingCash")}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{formatMoney(session.opening_cash)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.closingCash")}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{formatMoney(session.closing_cash)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.expectedCash")}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{formatMoney(session.cash_expected)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">{t("alerts.shiftSession.countedCash")}</dt><dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{formatMoney(session.cash_counted)}</dd></div>
        </dl>
      )}
    </section>
  );
}
