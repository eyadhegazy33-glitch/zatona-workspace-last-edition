import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, CalendarDays, Clock3, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  getBusinessDate,
  getShiftScheduleData,
  getShiftStaff,
  requestShiftSwap,
  type ShiftAssignment,
  type ShiftScheduleData,
  type ShiftTeamMember,
} from "../services/shifts";
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
  const [team, setTeam] = useState<ShiftTeamMember[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [today, setToday] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { timeZone } = await getOperationalRulesSettings();
      const businessToday = getBusinessDate(timeZone);
      const [schedule, staff] = await Promise.all([
        getShiftScheduleData(businessToday, addDays(businessToday, 60)),
        getShiftStaff(true),
      ]);
      setToday(businessToday);
      setData(schedule);
      setTeam(staff);
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
  const requestedAssignments = new Set(
    (data?.swap_requests ?? []).map((request) => request.assignment_id),
  );
  const dateFormatter = new Intl.DateTimeFormat(
    i18n.language.startsWith("ar") ? "ar-EG" : i18n.language,
    { dateStyle: "full", timeZone: "UTC" },
  );
  const fieldClass = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white";

  const askForCover = async (assignment: ShiftAssignment) => {
    const targetId = targets[assignment.id];
    if (!targetId || busy) {
      setError("shiftScreens.chooseCoworker");
      return;
    }
    setBusy(assignment.id);
    setError("");
    setNotice("");
    try {
      await requestShiftSwap(assignment.id, targetId);
      setNotice(t("shiftScreens.swapRequested"));
      setTargets((current) => ({ ...current, [assignment.id]: "" }));
      await refresh();
    } catch (cause) {
      const message = cause && typeof cause === "object" && "message" in cause
        ? String(cause.message).toLowerCase()
        : "";
      setError(message.includes("already pending")
        ? "shiftScreens.pendingSwap"
        : message.includes("not assigned")
          ? "shiftScreens.assignmentUnavailable"
          : "shiftScreens.swapFailed");
    } finally {
      setBusy("");
    }
  };

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
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" to="/shifts/current">
          <Clock3 size={17} />{t("shiftScreens.currentShift")}
        </Link>
      </header>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(error)}</p>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{notice}</p>}

      {loading && <p className="text-sm text-slate-500" role="status">{t("shiftScreens.refreshing")}</p>}
      {!loading && upcoming.length === 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-slate-600 dark:text-slate-300">{t("shiftScreens.noUpcoming")}</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("shiftScreens.noUpcomingCurrentHelp")}</p>
          <Link className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white" to="/shifts/current">
            <Clock3 size={17} />{t("shiftScreens.currentShift")}
          </Link>
        </section>
      )}
      <ul className="space-y-3">
        {upcoming.map((assignment) => {
          const hasRequest = requestedAssignments.has(assignment.id);
          const coworkers = team.filter((member) => member.id !== profile?.id);
          return (
            <li className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[minmax(0,1fr)_minmax(240px,auto)] sm:items-center" key={assignment.id}>
              <div>
                <h2 className="text-lg font-bold text-ink dark:text-white">{assignment.shift_name}</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{dateFormatter.format(new Date(`${assignment.work_date}T00:00:00Z`))}</p>
                <p className="mt-1 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Clock3 size={15} />{assignment.start_time.slice(0, 5)}–{assignment.end_time.slice(0, 5)}</p>
              </div>
              <div className="flex flex-col gap-2 sm:min-w-64">
                <label className="text-sm font-medium">
                  <span className="mb-1 block">{t("shiftScreens.askCoworker")}</span>
                  <select
                    className={`${fieldClass} w-full`}
                    disabled={hasRequest || busy === assignment.id || coworkers.length === 0}
                    onChange={(event) => setTargets((current) => ({ ...current, [assignment.id]: event.target.value }))}
                    value={targets[assignment.id] ?? ""}
                  >
                    <option value="">{t("shiftScreens.chooseCoworker")}</option>
                    {coworkers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={hasRequest || busy === assignment.id || coworkers.length === 0}
                  onClick={() => void askForCover(assignment)}
                  type="button"
                >
                  {busy === assignment.id ? <LoaderCircle className="animate-spin" size={16} /> : <ArrowLeftRight size={16} />}
                  {t(hasRequest ? "shiftScreens.swapPending" : "shiftScreens.askToTake")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
