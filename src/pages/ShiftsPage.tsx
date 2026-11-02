import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import {
  assignScheduledShift,
  decideShiftSwap,
  getBusinessDate,
  getShiftScheduleData,
  getShiftStaff,
  listClosedShiftSessions,
  removeScheduledShiftAssignment,
  saveScheduledShift,
  type ScheduledShift,
  type ShiftSession,
  type ShiftTeamMember,
} from "../services/shifts";
import { getOperationalRulesSettings } from "../services/settings";

type ShiftForm = {
  id: string | null;
  name: string;
  startTime: string;
  endTime: string;
  days: number[];
  active: boolean;
};

const blankShift: ShiftForm = {
  id: null,
  name: "",
  startTime: "09:00",
  endTime: "17:00",
  days: [0, 1, 2, 3, 4, 5, 6],
  active: true,
};
const shiftSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).min(1),
  active: z.boolean(),
}).refine((value) => value.startTime !== value.endTime, { path: ["endTime"] });

function addDays(date: string, count: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

export function ShiftsPage() {
  const { i18n, t } = useTranslation();
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [assignments, setAssignments] = useState<Awaited<ReturnType<typeof getShiftScheduleData>>["assignments"]>([]);
  const [team, setTeam] = useState<ShiftTeamMember[]>([]);
  const [allStaff, setAllStaff] = useState<ShiftTeamMember[]>([]);
  const [sessions, setSessions] = useState<ShiftSession[]>([]);
  const [pendingSwaps, setPendingSwaps] = useState<Awaited<ReturnType<typeof getShiftScheduleData>>["swap_requests"]>([]);
  const [currency, setCurrency] = useState("EGP");
  const [weekStart, setWeekStart] = useState("");
  const [sessionFrom, setSessionFrom] = useState("");
  const [sessionTo, setSessionTo] = useState("");
  const [sessionUser, setSessionUser] = useState("");
  const [shiftForm, setShiftForm] = useState<ShiftForm>(blankShift);
  const [cellShifts, setCellShifts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { timeZone, currencyCode } = await getOperationalRulesSettings();
      const today = getBusinessDate(timeZone);
      const currentWeek = weekStart || mondayOf(today);
      const from = sessionFrom || addDays(today, -30);
      const to = sessionTo || today;
      const [schedule, currentStaff, staffList, closedSessions] = await Promise.all([
        getShiftScheduleData(currentWeek, addDays(currentWeek, 6)),
        getShiftStaff(true),
        getShiftStaff(false),
        listClosedShiftSessions({ from, to, userId: sessionUser || null }),
      ]);
      setCurrency(currencyCode);
      setWeekStart(currentWeek);
      setSessionFrom(from);
      setSessionTo(to);
      setShifts(schedule.shifts);
      setAssignments(schedule.assignments);
      setTeam(currentStaff);
      setAllStaff(staffList);
      setPendingSwaps(schedule.swap_requests);
      setSessions(closedSessions);
    } catch {
      setError("shiftScreens.loadFailed");
    } finally {
      setLoading(false);
    }
  }, [sessionFrom, sessionTo, sessionUser, weekStart]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dayLabels = [
    t("shifts.days.monday"),
    t("shifts.days.tuesday"),
    t("shifts.days.wednesday"),
    t("shifts.days.thursday"),
    t("shifts.days.friday"),
    t("shifts.days.saturday"),
    t("shifts.days.sunday"),
  ];
  const dateFormatter = new Intl.DateTimeFormat(
    i18n.language.startsWith("ar") ? "ar-EG" : i18n.language,
    { dateStyle: "medium", timeZone: "UTC" },
  );
  const money = (amount: number) => new Intl.NumberFormat(
    i18n.language.startsWith("ar") ? "ar-EG" : i18n.language,
    { style: "currency", currency },
  ).format(amount);
  const days = useMemo(
    () => weekStart ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) : [],
    [weekStart],
  );
  const activeShifts = shifts.filter((shift) => shift.active);
  const pendingAssignmentIds = new Set(pendingSwaps.map((request) => request.assignment_id));
  const namesByUser = new Map(allStaff.map((member) => [member.id, member.name]));
  const nameByShift = new Map(shifts.map((shift) => [shift.id, shift.name]));
  const inputClass = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-ink dark:border-slate-700 dark:bg-slate-950 dark:text-white";

  const reportError = (cause: unknown) => {
    const message = cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : "";
    setError(message.includes("duplicate") || message.includes("unique")
      ? "shiftScreens.duplicateAssignment"
      : message.includes("weekday") || message.includes("scheduled")
        ? "shiftScreens.weekdayMismatch"
        : "shiftScreens.actionFailed");
  };

  const saveShift = async () => {
    const parsed = shiftSchema.safeParse({ ...shiftForm, days: [...new Set(shiftForm.days)] });
    if (!parsed.success || busy) {
      setError("shiftScreens.invalidShift");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveScheduledShift({ id: shiftForm.id, ...parsed.data });
      setShiftForm(blankShift);
      setNotice(t("shiftScreens.shiftSaved"));
      await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };

  const assignCell = async (userId: string, workDate: string) => {
    const key = `${userId}:${workDate}`;
    const shiftId = cellShifts[key];
    if (!shiftId || busy) return;
    const selected = activeShifts.find((shift) => shift.id === shiftId);
    const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay();
    if (!selected || !selected.days.includes(weekday)) {
      setError("shiftScreens.weekdayMismatch");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await assignScheduledShift({ shiftId, userId, workDate });
      setCellShifts((current) => ({ ...current, [key]: "" }));
      setNotice(t("shiftScreens.assignmentSaved"));
      await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };

  const cancelAssignment = async (assignmentId: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await removeScheduledShiftAssignment(assignmentId);
      setNotice(t("shiftScreens.assignmentRemoved"));
      await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };

  const decideSwap = async (requestId: string, approve: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await decideShiftSwap(requestId, approve);
      setNotice(t(approve ? "shiftScreens.swapApproved" : "shiftScreens.swapRejected"));
      await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (shift: ScheduledShift) => setShiftForm({
    id: shift.id,
    name: shift.name,
    startTime: shift.start_time.slice(0, 5),
    endTime: shift.end_time.slice(0, 5),
    days: [...shift.days],
    active: shift.active,
  });

  if (loading && shifts.length === 0 && team.length === 0) {
    return <div className="grid min-h-64 place-items-center" role="status"><LoaderCircle className="animate-spin text-brand" size={30} /></div>;
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-7 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-brand"><CalendarDays size={17} />{t("shiftScreens.management")}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink dark:text-white">{t("shiftScreens.weeklySchedule")}</h1>
        </div>
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" to="/shifts/current">
          {t("shiftScreens.currentShift")}
        </Link>
      </header>
      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t(error)}</p>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{notice}</p>}

      <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,.7fr)]">
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t(shiftForm.id ? "shiftScreens.editDefinition" : "shiftScreens.newDefinition")}</h2>
          <label className="block text-sm font-medium">
            <span className="mb-1 block">{t("shiftScreens.shiftName")}</span>
            <input className={inputClass} maxLength={80} onChange={(event) => setShiftForm((value) => ({ ...value, name: event.target.value }))} value={shiftForm.name} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium"><span className="mb-1 block">{t("shiftScreens.startTime")}</span><input className={inputClass} onChange={(event) => setShiftForm((value) => ({ ...value, startTime: event.target.value }))} type="time" value={shiftForm.startTime} /></label>
            <label className="text-sm font-medium"><span className="mb-1 block">{t("shiftScreens.endTime")}</span><input className={inputClass} onChange={(event) => setShiftForm((value) => ({ ...value, endTime: event.target.value }))} type="time" value={shiftForm.endTime} /></label>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t("shiftScreens.daysOfWeek")}</legend>
            <div className="flex flex-wrap gap-2">
              {dayLabels.map((label, index) => {
                const weekday = (index + 1) % 7;
                const checked = shiftForm.days.includes(weekday);
                return <label className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm ${checked ? "border-brand bg-brand/10 text-brand" : "border-slate-300 dark:border-slate-700"}`} key={weekday}><input checked={checked} className="accent-brand" onChange={() => setShiftForm((value) => ({ ...value, days: checked ? value.days.filter((day) => day !== weekday) : [...value.days, weekday] }))} type="checkbox" />{label}</label>;
              })}
            </div>
          </fieldset>
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input checked={shiftForm.active} className="size-4 accent-brand" onChange={(event) => setShiftForm((value) => ({ ...value, active: event.target.checked }))} type="checkbox" />{t("shiftScreens.active")}</label>
          <div className="flex gap-2">
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void saveShift()} type="button">{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}{t("shiftScreens.saveDefinition")}</button>
            {shiftForm.id && <button className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" onClick={() => setShiftForm(blankShift)} type="button">{t("shiftScreens.cancelEdit")}</button>}
          </div>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {shifts.map((shift) => <div className="flex items-center justify-between gap-2 p-3" key={shift.id}><div className="min-w-0"><p className="truncate font-semibold text-ink dark:text-white">{shift.name} · {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</p><p className="text-xs text-slate-500">{shift.days.map((day) => dayLabels[(day + 6) % 7]).join(", ")} · {t(shift.active ? "shiftScreens.active" : "shiftScreens.inactive")}</p></div><button aria-label={t("shiftScreens.editDefinition")} className="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => startEditing(shift)} type="button"><Pencil size={16} /></button></div>)}
            {shifts.length === 0 && <p className="p-3 text-sm text-slate-500">{t("shiftScreens.noDefinitions")}</p>}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t("shiftScreens.swapRequests")}</h2>
          {pendingSwaps.length === 0 ? <p className="text-sm text-slate-500">{t("shiftScreens.noSwapRequests")}</p> : pendingSwaps.map((request) => (
            <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800" key={request.id}>
              <p className="text-sm text-slate-700 dark:text-slate-200">{t("shiftScreens.swapRequestDescription", { requester: request.requester_name, target: request.target_name, shift: request.shift_name, date: dateFormatter.format(new Date(`${request.work_date}T00:00:00Z`)) })}</p>
              <div className="flex gap-2"><button className="min-h-10 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void decideSwap(request.id, true)} type="button">{t("shiftScreens.approve")}</button><button className="min-h-10 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300" disabled={busy} onClick={() => void decideSwap(request.id, false)} type="button">{t("shiftScreens.reject")}</button></div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t("shiftScreens.weeklySchedule")}</h2>
          <div className="flex items-center gap-2">
            <button aria-label={t("shiftScreens.previousWeek")} className="grid size-10 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => setWeekStart(addDays(weekStart, -7))} type="button"><ChevronLeft size={18} /></button>
            <input aria-label={t("shiftScreens.weekStarting")} className={`${inputClass} w-40`} onChange={(event) => setWeekStart(mondayOf(event.target.value))} type="date" value={weekStart} />
            <button aria-label={t("shiftScreens.nextWeek")} className="grid size-10 place-items-center rounded-lg border border-slate-300 dark:border-slate-700" onClick={() => setWeekStart(addDays(weekStart, 7))} type="button"><ChevronRight size={18} /></button>
          </div>
        </div>
        {loading && <p className="mb-3 text-xs text-slate-500" role="status">{t("shiftScreens.refreshing")}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-start text-sm">
            <thead><tr><th className="sticky start-0 bg-white p-2 text-start dark:bg-slate-900">{t("shiftScreens.employee")}</th>{days.map((day, index) => <th className="min-w-32 p-2 text-start" key={day}><span className="block font-semibold">{dayLabels[index]}</span><span className="text-xs font-normal text-slate-500">{dateFormatter.format(new Date(`${day}T00:00:00Z`))}</span></th>)}</tr></thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {team.map((member) => <tr key={member.id}>
                <th className="sticky start-0 min-w-36 bg-white p-2 text-start font-semibold text-ink dark:bg-slate-900 dark:text-white">{member.name}</th>
                {days.map((day) => {
                  const key = `${member.id}:${day}`;
                  const cellAssignments = assignments.filter((assignment) => assignment.user_id === member.id && assignment.work_date === day);
                  return <td className="min-w-32 p-2 align-top" key={key}>
                    <div className="space-y-2">
                      {cellAssignments.map((assignment) => <div className="rounded-lg bg-brand/10 p-2 text-xs text-ink dark:text-slate-100" key={assignment.id}>
                        <div className="flex items-start justify-between gap-1"><span className="font-semibold">{assignment.shift_name}</span><button aria-label={t("shiftScreens.removeAssignment")} className="text-red-700 dark:text-red-300" disabled={busy || pendingAssignmentIds.has(assignment.id)} onClick={() => void cancelAssignment(assignment.id)} type="button"><Trash2 size={14} /></button></div>
                        <span className="mt-1 block">{assignment.start_time.slice(0, 5)}–{assignment.end_time.slice(0, 5)}</span>
                      </div>)}
                      <div className="flex gap-1">
                        <select aria-label={t("shiftScreens.assignShift", { employee: member.name, date: dateFormatter.format(new Date(`${day}T00:00:00Z`)) })} className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-1 text-xs dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setCellShifts((current) => ({ ...current, [key]: event.target.value }))} value={cellShifts[key] ?? ""}>
                          <option value="">{t("shiftScreens.addShift")}</option>
                          {activeShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
                        </select>
                        <button aria-label={t("shiftScreens.addAssignment")} className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-white disabled:opacity-40" disabled={!cellShifts[key] || busy} onClick={() => void assignCell(member.id, day)} type="button"><Plus size={15} /></button>
                      </div>
                    </div>
                  </td>;
                })}
              </tr>)}
              {team.length === 0 && <tr><td className="p-4 text-center text-slate-500" colSpan={8}>{t("shiftScreens.noStaff")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-xl font-bold text-ink dark:text-white">{t("shiftScreens.closedSessions")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm"><span className="mb-1 block">{t("shiftScreens.from")}</span><input className={inputClass} onChange={(event) => setSessionFrom(event.target.value)} type="date" value={sessionFrom} /></label>
          <label className="text-sm"><span className="mb-1 block">{t("shiftScreens.to")}</span><input className={inputClass} onChange={(event) => setSessionTo(event.target.value)} type="date" value={sessionTo} /></label>
          <label className="text-sm"><span className="mb-1 block">{t("shiftScreens.employee")}</span><select className={inputClass} onChange={(event) => setSessionUser(event.target.value)} value={sessionUser}><option value="">{t("shiftScreens.allStaff")}</option>{allStaff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>
        </div>
        <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" disabled={loading} onClick={() => void refresh()} type="button">{t("shiftScreens.applyFilters")}</button>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead><tr className="border-b border-slate-200 text-start dark:border-slate-800"><th className="p-2 text-start">{t("shiftScreens.employee")}</th><th className="p-2 text-start">{t("shiftScreens.shiftName")}</th><th className="p-2 text-start">{t("shiftScreens.openedAt")}</th><th className="p-2 text-start">{t("shiftScreens.closedAt")}</th><th className="p-2 text-end">{t("shiftScreens.expectedCash")}</th><th className="p-2 text-end">{t("shiftScreens.countedCash")}</th><th className="p-2 text-end">{t("shiftScreens.difference")}</th></tr></thead>
            <tbody>
              {sessions.map((session) => {
                const difference = session.cash_counted === null || session.cash_expected === null
                  ? null
                  : session.cash_counted - session.cash_expected;
                return <tr className="border-b border-slate-100 dark:border-slate-800" key={session.id}>
                  <td className="p-2">{namesByUser.get(session.user_id) ?? session.user_id}</td>
                  <td className="p-2">{nameByShift.get(session.shift_id ?? "") ?? t("shiftScreens.unplannedShift")}</td>
                  <td className="p-2">{dateFormatter.format(new Date(session.opened_at))}</td>
                  <td className="p-2">{session.closed_at ? dateFormatter.format(new Date(session.closed_at)) : "—"}</td>
                  <td className="p-2 text-end">{session.cash_expected === null ? "—" : money(session.cash_expected)}</td>
                  <td className="p-2 text-end">{session.cash_counted === null ? "—" : money(session.cash_counted)}</td>
                  <td className={`p-2 text-end font-semibold ${difference === null ? "" : difference < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>{difference === null ? "—" : money(difference)}</td>
                </tr>;
              })}
              {sessions.length === 0 && <tr><td className="p-4 text-center text-slate-500" colSpan={7}>{t("shiftScreens.noClosedSessions")}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
