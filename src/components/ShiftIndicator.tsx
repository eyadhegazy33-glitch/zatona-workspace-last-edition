import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { getOpenShiftSession, type ShiftSession } from "../services/shifts";

export function ShiftIndicator() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const canUseShifts = permissions.includes("shifts.use");
  const [session, setSession] = useState<ShiftSession | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile?.id || !canUseShifts) return;
    try {
      setSession(await getOpenShiftSession(profile.id));
      setError(false);
    } catch {
      setError(true);
    }
  }, [canUseShifts, profile?.id]);

  useEffect(() => {
    if (!canUseShifts) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const handleRefresh = () => void refresh();
    window.addEventListener("shift-session-changed", handleRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("shift-session-changed", handleRefresh);
    };
  }, [canUseShifts, refresh]);

  if (!canUseShifts) return null;

  const openedTime = session
    ? new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(session.opened_at))
    : "";

  return (
    <div className="flex min-w-0 items-center gap-1">
      {error ? (
        <button
          className="max-w-28 truncate text-[10px] font-medium text-red-700 underline dark:text-red-300 sm:max-w-40 sm:text-xs"
          onClick={() => void refresh()}
          type="button"
        >
          {t("shiftScreens.indicatorError")}
        </button>
      ) : (
        <span className="max-w-24 truncate text-[10px] font-medium text-slate-600 dark:text-slate-300 sm:max-w-56 sm:text-xs">
          {session
            ? t("shiftScreens.indicatorOpen", {
                time: openedTime,
                name: session.shift_name ?? t("shiftScreens.unplannedShift"),
              })
            : t("shiftScreens.indicatorClosed")}
        </span>
      )}
      {!session && !error && (
        <Link
          className="inline-flex min-h-9 items-center rounded-lg bg-brand px-2 text-[10px] font-semibold text-white hover:bg-brand/90 sm:px-3 sm:text-xs"
          to="/shifts/current"
        >
          {t("shiftScreens.open")}
        </Link>
      )}
      {session && (
        <Link
          aria-label={t("shiftScreens.manageCurrent")}
          className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-2 text-[10px] font-semibold dark:border-slate-700 sm:px-3 sm:text-xs"
          to="/shifts/current"
        >
          {t("shiftScreens.view")}
        </Link>
      )}
    </div>
  );
}
