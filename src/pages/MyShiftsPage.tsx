import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getBusinessDate, getShiftScheduleData, type ShiftScheduleData } from "../services/shifts";
import { getOperationalRulesSettings } from "../services/settings";

function addDays(date: string, count: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

export function MyShiftsPage() {
  const { i18n, t } = useTranslation();
  const { profile } = useAuth();
  const [data, setData] = useState<ShiftScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [today, setToday] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { timeZone } = await getOperationalRulesSettings();
      const businessToday = getBusinessDate(timeZone);
      const schedule = await getShiftScheduleData(businessToday, addDays(businessToday, 60));
      setToday(businessToday);
      setData(schedule);
    } catch {
      setError("shiftScreens.loadFailed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upcoming = (data?.assignments ?? [])
    .filter((assignment) => assignment.user_id === profile?.id && assignment.work_date >= today)
    .sort((left, right) => left.work_date.localeCompare(right.work_date) ||
      left.start_time.localeCompare(right.start_time));
  const dateFormatter = new Intl.DateTimeFormat(
    i18n.language.startsWith("ar") ? "ar-EG" : i18n.language,
    { dateStyle: "full", timeZone: "UTC" },
  );

  if (loading && !data) {
    return <div className="grid min-h-64 place-items-center" role="status"><LoaderCircle className="animate-spin text-brand" size={30} /></div>;
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-7 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-brand"><CalendarDays size={17} />{t("shiftScreens.myShifts")}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink dark:text-white">{t("shiftScreens.upcomingTitle")}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 font-semibold disabled:opacity-50 dark:border-slate-700"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            {loading ? <LoaderCircle className="animate-spin" size={17} /> : <RefreshCw size={17} />}
            {t("shiftScreens.refresh")}
          </button>
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" to="/shifts/current">
            <Clock3 size={17} />{t("shiftScreens.currentShift")}
          </Link>
        </div>
      </header>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(error)}</p>}
      {loading && <p className="text-sm text-slate-500" role="status">{t("shiftScreens.refreshing")}</p>}

      {!loading && upcoming.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {t("shiftScreens.noUpcoming")}
        </section>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {upcoming.map((assignment) => (
            <li className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" key={assignment.id}>
              <h2 className="text-lg font-bold text-ink dark:text-white">{assignment.shift_name}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{dateFormatter.format(new Date(`${assignment.work_date}T00:00:00Z`))}</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Clock3 size={15} />{assignment.start_time.slice(0, 5)}–{assignment.end_time.slice(0, 5)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
