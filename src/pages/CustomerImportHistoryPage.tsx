import { Download, RotateCcw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getImportErrors, getImportHistory, rollbackCustomerImport, type ImportSummary } from "../services/imports";

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CustomerImportHistoryPage() {
  const { i18n, t } = useTranslation();
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getImportHistory();
      setImports(result);
    } catch {
      setError(t("customers.import.historyError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [t]);

  const handleRollback = async (importId: string) => {
    const confirmed = window.confirm(t("customers.import.rollbackConfirm"));
    if (!confirmed) return;
    setRollingBackId(importId);
    try {
      await rollbackCustomerImport(importId);
      await refresh();
    } catch {
      setError(t("customers.import.rollbackError"));
    } finally {
      setRollingBackId(null);
    }
  };

  const downloadErrors = async (importId: string) => {
    setDownloadingId(importId);
    setError("");
    try {
      const errors = await getImportErrors(importId);
      const csv = [
        "row_number,reason",
        ...errors.map(
          (row) =>
            `"${row.row_number}","${row.reason.replace(/"/g, '""')}"`,
        ),
      ].join("\n");
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `import-errors-${importId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t("customers.import.downloadErrorFailed"));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">{t("customers.import.title")}</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink dark:text-white">{t("customers.import.historyTitle")}</h1>
        </div>
        <Link className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200" to="/customers/import">
          {t("customers.import.backToWizard")}
        </Link>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-950">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("customers.import.historyUser")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.import.historyWhen")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.import.historyFile")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.import.historyCounts")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.import.historyStatus")}</th>
                <th className="px-4 py-3 font-semibold">{t("customers.import.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500 dark:text-slate-400" colSpan={6}>
                    {t("customers.import.loadingHistory")}
                  </td>
                </tr>
              )}
              {!loading && imports.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500 dark:text-slate-400" colSpan={6}>
                    {t("customers.import.historyEmpty")}
                  </td>
                </tr>
              )}
              {!loading && imports.map((item) => {
                const userName = [item.user?.first_name, item.user?.last_name].filter(Boolean).join(" ") || "—";
                return (
                  <tr key={item.id} className="align-top text-slate-700 dark:text-slate-200">
                    <td className="px-4 py-3">{userName}</td>
                    <td className="px-4 py-3">{formatDate(item.created_at, i18n.language)}</td>
                    <td className="px-4 py-3">{item.filename || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-1 text-xs">
                        <div>{t("customers.import.result.created")}: {item.created}</div>
                        <div>{t("customers.import.result.updated")}: {item.updated}</div>
                        <div>{t("customers.import.result.skipped")}: {item.skipped}</div>
                        <div>{t("customers.import.result.failed")}: {item.failed}</div>
                        <div>{t("customers.import.totalRecords")}: {item.total}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.rolled_back_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          <ShieldAlert size={12} /> {t("customers.import.rolledBack")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {t("customers.import.active")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200" disabled={downloadingId === item.id} onClick={() => void downloadErrors(item.id)} type="button">
                          <Download size={14} />
                          {t("customers.import.downloadErrors")}
                        </button>
                        {!item.rolled_back_at && (
                          <button className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-2.5 py-2 text-xs font-semibold text-white disabled:opacity-60" disabled={rollingBackId === item.id} onClick={() => void handleRollback(item.id)} type="button">
                            <RotateCcw size={14} />
                            {rollingBackId === item.id ? t("customers.import.rollingBack") : t("customers.import.rollback")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
