import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { AlertOverview } from "../services/alerts";

type AlertCriticalBannerProps = {
  overview: AlertOverview | null;
  error: boolean;
  onRetry: () => void;
  sticky?: boolean;
};

export function AlertCriticalBanner({
  overview,
  error,
  onRetry,
  sticky = true,
}: AlertCriticalBannerProps) {
  const { t } = useTranslation();
  const positionClass = sticky ? "sticky top-16 z-20" : "";

  if (error) {
    return (
      <div className={`${positionClass} flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100 sm:px-6`} role="alert">
        <span>{t("alerts.errors.overview")}</span>
        <button className="shrink-0 font-semibold underline" onClick={onRetry} type="button">
          {t("alerts.actions.retry")}
        </button>
      </div>
    );
  }
  if (!overview?.critical_unacknowledged) return null;

  return (
    <Link
      className={`${positionClass} flex items-center gap-3 border-b border-red-800 bg-red-700 px-4 py-3 text-white shadow-sm transition hover:bg-red-800 sm:px-6`}
      to="/alerts"
    >
      <AlertTriangle aria-hidden="true" className="shrink-0" size={20} />
      <span className="flex-1 text-sm font-bold">{t("alerts.criticalBanner")}</span>
      <span className="text-sm font-semibold underline">{t("alerts.openCenter")}</span>
    </Link>
  );
}
