import { useTranslation } from "react-i18next";
import { useLiveTimers } from "../hooks/useLiveTimers";
import { getSecondsLeft, getTimerState } from "../lib/timerMath";

type TimerWidgetProps = {
  customerId?: string;
  checkinId?: number;
  enabled: boolean;
};

function formatDuration(seconds: number): string {
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const remaining = absolute % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
}

export function TimerWidget({
  customerId,
  checkinId,
  enabled,
}: TimerWidgetProps) {
  const { i18n, t } = useTranslation();
  const { timers, serverOffsetMs, now, loading, error, refresh } =
    useLiveTimers(enabled);
  const timer = timers.find(
    (row) =>
      (checkinId !== undefined && row.checkin_id === checkinId) ||
      (customerId !== undefined && row.customer_id === customerId),
  );

  if (!enabled) return null;

  const secondsLeft = timer
    ? getSecondsLeft(timer.deadline, now, serverOffsetMs)
    : null;
  const state = timer
    ? getTimerState(timer.deadline, timer.warning_at, now, serverOffsetMs)
    : "ok";
  const colors = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    overdue: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  } as const;
  const locale = i18n.language.startsWith("ar") ? "ar-EG" : i18n.language;
  const feeAmount = (amount: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  return (
    <section
      className={`rounded-xl border p-3 sm:p-4 ${timer ? colors[state] : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}
    >
      {loading && !timer ? (
        <p className="text-sm">{t("timers.loading")}</p>
      ) : error && !timer ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">{t("timers.errors.load")}</p>
          <button
            className="text-sm font-semibold underline"
            onClick={() => void refresh()}
            type="button"
          >
            {t("timers.retry")}
          </button>
        </div>
      ) : !timer || secondsLeft === null ? (
        <p className="text-sm">{t("timers.notInside")}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">
              {t(`timers.state.${state}`)}
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums sm:text-3xl">
              {secondsLeft < 0 ? "+" : ""}
              {formatDuration(secondsLeft)}
            </p>
          </div>
          <p className="text-sm font-semibold">
            {t("timers.feesDue", { amount: feeAmount(timer.fees_due) })}
          </p>
        </div>
      )}
    </section>
  );
}
