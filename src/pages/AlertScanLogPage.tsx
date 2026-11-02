import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LoaderCircle, ScanLine } from "lucide-react";
import { getAlertScanLog } from "../services/alerts";

type ScanRows = Awaited<ReturnType<typeof getAlertScanLog>>;

export function AlertScanLogPage() {
  const { i18n, t } = useTranslation();
  const { alertId = "" } = useParams();
  const [rows, setRows] = useState<ScanRows>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(false);
    try {
      setRows(await getAlertScanLog(alertId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [alertId]);

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink dark:text-white"><ScanLine className="text-brand" size={23} />{t("alerts.scanLog.title")}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("alerts.scanLog.description")}</p>
      {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-slate-500" role="status"><LoaderCircle className="animate-spin" size={17} />{t("alerts.loading")}</p> : error ? (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("alerts.errors.related")} <button className="ms-2 font-semibold underline" onClick={() => void refresh()} type="button">{t("alerts.actions.retry")}</button></p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">{t("alerts.scanLog.empty")}</p>
      ) : (
        <ul className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {rows.map((row) => (
            <li className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between" key={row.scan_id}>
              <span className="font-medium text-ink dark:text-white">{t(`alerts.scanLog.results.${row.result}`)}</span>
              <time className="text-sm text-slate-500 dark:text-slate-400" dateTime={row.created_at}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.created_at))}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
