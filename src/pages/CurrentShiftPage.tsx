import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock3, LoaderCircle, Printer } from "lucide-react";
import { z } from "zod";
import { useAuth } from "../hooks/useAuth";
import { getSupabaseClient } from "../lib/supabase";
import {
  closeShiftSession,
  getBusinessDate,
  getLastHandoverNote,
  getOpenShiftSession,
  getShiftScheduleData,
  getShiftSummary,
  getShiftUnpaidOrders,
  openShiftSession,
  type ScheduledShift,
  type ShiftSession,
  type ShiftSummary,
  type UnpaidShiftOrder,
} from "../services/shifts";
import { getOperationalRulesSettings } from "../services/settings";
import { useBranding } from "../hooks/useBranding";

const cashSchema = z.coerce.number().finite().min(0).max(100_000_000);
const closeSchema = z.object({
  countedCash: z.string().trim().min(1).refine((value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000;
  }).transform(Number),
  note: z.string().trim().max(1000),
});

type PrintLayout = "thermal" | "a4";

function ShiftSummaryPrint({
  summary,
  shiftName,
  layout,
  onLayoutChange,
  currency,
  dir,
}: {
  summary: ShiftSummary;
  shiftName: string | null;
  layout: PrintLayout;
  onLayoutChange: (layout: PrintLayout) => void;
  currency: string;
  dir: string;
}) {
  const { t, i18n } = useTranslation();
  const { settings } = useBranding();
  const [printing, setPrinting] = useState(false);
  const money = (value: number) => new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency,
  }).format(value);
  const opened = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(summary.opened_at));
  const closed = summary.closed_at
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(summary.closed_at))
    : "";
  const difference = summary.cash_difference ?? 0;
  const content = (
    <article
      className={`shift-summary-print shift-summary-print-${layout}`}
      dir={dir}
      lang={dir === "rtl" ? "ar" : "en"}
    >
      {settings.logoUrl && <img alt="" className="shift-summary-logo" src={settings.logoUrl} />}
      <h1>{settings.workspaceName}</h1>
      <h2>{t("shiftScreens.closedSummary")}</h2>
      <p>{t("shiftScreens.shiftName")}: {shiftName ?? t("shiftScreens.unplannedShift")}</p>
      <p>{t("shiftScreens.openedAt")}: {opened}</p>
      <p>{t("shiftScreens.closedAt")}: {closed}</p>
      <hr />
      <p>{t("shiftScreens.ordersCount")}: {summary.orders_count}</p>
      <p>{t("shiftScreens.unpaidOrders")}: {summary.unpaid_orders}</p>
      <p>{t("shiftScreens.expectedCash")}: {money(summary.cash_expected)}</p>
      <p>{t("shiftScreens.countedCash")}: {money(summary.cash_counted ?? 0)}</p>
      <p className="shift-summary-difference">{t("shiftScreens.difference")}: {money(difference)}</p>
      <hr />
      {Object.entries(summary.receipts_by_method).map(([method, total]) => (
        <p key={method}>{t(`shiftScreens.methods.${method}`, { defaultValue: method })}: {money(total)}</p>
      ))}
    </article>
  );
  const print = () => {
    document.body.classList.add("printing-shift-summary", `shift-summary-layout-${layout}`);
    setPrinting(true);
    window.setTimeout(() => window.print(), 50);
  };
  useEffect(() => {
    const cleanup = () => {
      document.body.classList.remove("printing-shift-summary", "shift-summary-layout-thermal", "shift-summary-layout-a4");
      setPrinting(false);
    };
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">{t("shiftScreens.printLayout")}</span>
          <select
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            onChange={(event) => {
              const next = event.target.value === "a4" ? "a4" : "thermal";
              onLayoutChange(next);
            }}
            value={layout}
          >
            <option value="thermal">{t("shiftScreens.thermal")}</option>
            <option value="a4">{t("shiftScreens.a4")}</option>
          </select>
        </label>
        <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white" disabled={printing} onClick={print} type="button">
          <Printer size={16} />{t("shiftScreens.printSummary")}
        </button>
      </div>
      {createPortal(content, document.body)}
    </>
  );
}

export function CurrentShiftPage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<ShiftSession | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [closedSummary, setClosedSummary] = useState<ShiftSummary | null>(null);
  const [closedShiftName, setClosedShiftName] = useState<string | null>(null);
  const [assignedShifts, setAssignedShifts] = useState<ScheduledShift[]>([]);
  const [selectedShift, setSelectedShift] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [currency, setCurrency] = useState("EGP");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [unpaidCount, setUnpaidCount] = useState<number | null>(null);
  const [unpaidOrders, setUnpaidOrders] = useState<UnpaidShiftOrder[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printLayout, setPrintLayout] = useState<PrintLayout>("thermal");

  const refreshSummary = useCallback(async (sessionId: string) => {
    try {
      setSummary(await getShiftSummary(sessionId));
      setError("");
    } catch {
      setError("shiftScreens.loadFailed");
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError("");
    try {
      const rules = await getOperationalRulesSettings();
      const today = getBusinessDate(rules.timeZone);
      setCurrency(rules.currencyCode);
      const [current, schedule, note] = await Promise.all([
        getOpenShiftSession(profile.id),
        getShiftScheduleData(today, today),
        getLastHandoverNote(),
      ]);
      setSession(current);
      setLastNote(note);
      const assigned = schedule.shifts.filter((shift) =>
        shift.active && schedule.assignments.some((assignment) =>
          assignment.user_id === profile.id && assignment.shift_id === shift.id,
        ),
      );
      setAssignedShifts(assigned);
      setSelectedShift((currentValue) => {
        if (current?.shift_id && assigned.some((shift) => shift.id === current.shift_id)) {
          return current.shift_id;
        }
        return currentValue && assigned.some((shift) => shift.id === currentValue)
          ? currentValue
          : assigned.length === 1 ? assigned[0].id : "";
      });
      if (current) {
        await refreshSummary(current.id);
      } else {
        setSummary(null);
      }
    } catch {
      setError("shiftScreens.loadFailed");
    } finally {
      setLoading(false);
    }
  }, [profile?.id, refreshSummary]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`current-shift-${session.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "receipts",
        filter: `shift_session_id=eq.${session.id}`,
      }, () => void refreshSummary(session.id))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "orders",
        filter: `shift_session_id=eq.${session.id}`,
      }, () => void refreshSummary(session.id))
      .subscribe();
    const timer = window.setInterval(() => void refreshSummary(session.id), 30_000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refreshSummary, session]);

  const money = useMemo(() => (value: number) => new Intl.NumberFormat(
    i18n.language.startsWith("ar") ? "ar-EG" : i18n.language,
    { style: "currency", currency },
  ).format(value), [currency, i18n.language]);

  const open = async () => {
    const parsedCash = cashSchema.safeParse(openingCash === "" ? 0 : openingCash);
    if (!parsedCash.success || busy) {
      setError("shiftScreens.invalidCash");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const opened = await openShiftSession(selectedShift || null, parsedCash.data);
      setSession(opened);
      setClosedSummary(null);
      setNotice(t("shiftScreens.shiftOpened"));
      window.dispatchEvent(new Event("shift-session-changed"));
      await refreshSummary(opened.id);
    } catch {
      setError("shiftScreens.openFailed");
    } finally {
      setBusy(false);
    }
  };

  const close = async (confirmUnpaid: boolean) => {
    if (!session) return;
    const parsed = closeSchema.safeParse({ countedCash, note: handoverNote });
    if (!parsed.success || busy) {
      setError("shiftScreens.invalidClose");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const closed = await closeShiftSession({
        sessionId: session.id,
        countedCash: parsed.data.countedCash,
        note: parsed.data.note,
        confirmUnpaid,
      });
      setClosedShiftName(session.shift_name);
      setClosedSummary(closed);
      setSummary(null);
      setSession(null);
      setShowCloseDialog(false);
      setUnpaidCount(null);
      setUnpaidOrders([]);
      setHandoverNote("");
      setNotice(t("shiftScreens.shiftClosed"));
      window.dispatchEvent(new Event("shift-session-changed"));
    } catch (cause) {
      const failure = cause && typeof cause === "object" ? cause as { message?: unknown; details?: unknown } : {};
      if (failure.message === "unpaid_orders") {
        try {
          const orders = await getShiftUnpaidOrders(session.id);
          setUnpaidOrders(orders);
          const parsedCount = Number(failure.details);
          setUnpaidCount(Number.isInteger(parsedCount) && parsedCount >= 0 ? parsedCount : orders.length);
          setShowCloseDialog(true);
        } catch {
          setError("shiftScreens.unpaidOrdersLoadFailed");
        }
      } else {
        setError("shiftScreens.closeFailed");
      }
    } finally {
      setBusy(false);
    }
  };

  const goToUnpaidOrders = () => {
    navigate("/orders", { state: { unpaidOnly: true } });
  };

  if (loading && !session && !closedSummary) {
    return <div className="grid min-h-64 place-items-center" role="status"><LoaderCircle className="animate-spin text-brand" size={30} /></div>;
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-7 sm:px-6 lg:px-8" dir={i18n.dir()}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-brand"><Clock3 size={17} />{t("shiftScreens.currentShift")}</p>
          <h1 className="mt-1 text-3xl font-bold text-ink dark:text-white">{t("shiftScreens.currentTitle")}</h1>
        </div>
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700" to="/shifts/my">{t("shiftScreens.myShifts")}</Link>
      </header>
      <aside className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
        <p>{t("shiftScreens.separatePosShift")}</p>
        {permissions.includes("orders.view") && <Link className="mt-2 inline-flex font-semibold underline" to="/pos">{t("layout.navigation.pos")}</Link>}
      </aside>
      {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert"><span>{t(error)}</span>{session && !summary && <button className="font-semibold underline" disabled={loading} onClick={() => void refresh()} type="button">{t("shiftScreens.refresh")}</button>}</div>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{notice}</p>}

      {!session && !closedSummary && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t("shiftScreens.openShiftTitle")}</h2>
          {lastNote && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">{t("shiftScreens.lastHandoverNote")}</p><p className="mt-1 whitespace-pre-wrap">{lastNote}</p></div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium"><span className="mb-1 block">{t("shiftScreens.plannedShift")}</span>
              <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setSelectedShift(event.target.value)} value={selectedShift}>
                <option value="">{t("shiftScreens.unplannedShift")}</option>
                {assignedShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium"><span className="mb-1 block">{t("shiftScreens.openingCash")}</span><input className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" min="0" onChange={(event) => setOpeningCash(event.target.value)} step="0.01" type="number" value={openingCash} /></label>
          </div>
          <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void open()} type="button">{busy && <LoaderCircle className="animate-spin" size={17} />}{t("shiftScreens.openShift")}</button>
        </section>
      )}

      {session && summary && (
        <section className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-5 dark:border-emerald-900 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t("shiftScreens.shiftIsOpen")}</p><h2 className="mt-1 text-2xl font-bold text-ink dark:text-white">{session.shift_name ?? t("shiftScreens.unplannedShift")}</h2><p className="mt-1 text-sm text-slate-500">{t("shiftScreens.openedAt")}: {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.opened_at))}</p></div>
            <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" disabled={loading} onClick={() => void refresh()} type="button">{t("shiftScreens.refresh")}</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryStat label={t("shiftScreens.ordersCount")} value={String(summary.orders_count)} />
            <SummaryStat label={t("shiftScreens.unpaidOrders")} value={String(summary.unpaid_orders)} />
            <SummaryStat label={t("shiftScreens.expectedCash")} value={money(summary.cash_expected)} />
            {Object.entries(summary.receipts_by_method).map(([method, total]) => <SummaryStat key={method} label={t(`shiftScreens.methods.${method}`, { defaultValue: method })} value={money(total)} />)}
          </div>
          <button className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white" onClick={() => setShowCloseDialog(true)} type="button">{t("shiftScreens.closeShift")}</button>
        </section>
      )}

      {closedSummary && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-bold text-ink dark:text-white">{t("shiftScreens.closedSummary")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryStat label={t("shiftScreens.expectedCash")} value={money(closedSummary.cash_expected)} />
            <SummaryStat label={t("shiftScreens.countedCash")} value={money(closedSummary.cash_counted ?? 0)} />
            <SummaryStat label={t("shiftScreens.difference")} value={money(closedSummary.cash_difference ?? 0)} valueClass={(closedSummary.cash_difference ?? 0) < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"} />
            <SummaryStat label={t("shiftScreens.ordersCount")} value={String(closedSummary.orders_count)} />
          </div>
          <ShiftSummaryPrint summary={closedSummary} shiftName={closedShiftName} layout={printLayout} onLayoutChange={setPrintLayout} currency={currency} dir={i18n.dir()} />
          <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" onClick={() => { setClosedSummary(null); setNotice(""); }} type="button">{t("shiftScreens.openAnotherShift")}</button>
        </section>
      )}

      {showCloseDialog && session && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCloseDialog(false); }}>
          <section aria-labelledby="close-shift-title" aria-modal="true" className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" role="dialog">
            <h2 className="text-xl font-bold text-ink dark:text-white" id="close-shift-title">{t("shiftScreens.closeShiftTitle")}</h2>
            {unpaidCount !== null && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p>{t("shiftScreens.unpaidWarning", { count: unpaidCount })}</p><ul className="mt-2 list-inside list-disc">{unpaidOrders.map((order) => <li key={order.order_id}>{t("shiftScreens.orderNumber", { number: order.order_number })} · {money(order.total)}</li>)}</ul></div>}
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("shiftScreens.countedCash")}</span><input autoFocus className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" min="0" onChange={(event) => setCountedCash(event.target.value)} step="0.01" type="number" value={countedCash} /></label>
            <label className="block text-sm font-medium"><span className="mb-1 block">{t("shiftScreens.handoverNote")}</span><textarea className="min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={1000} onChange={(event) => setHandoverNote(event.target.value)} value={handoverNote} /></label>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" disabled={busy} onClick={() => setShowCloseDialog(false)} type="button">{t("shiftScreens.cancel")}</button>
              {unpaidCount !== null ? <>
                <button className="min-h-10 rounded-lg border border-amber-600 px-3 text-sm font-semibold text-amber-800 dark:text-amber-200" disabled={busy} onClick={goToUnpaidOrders} type="button">{t("shiftScreens.goToUnpaidOrders")}</button>
                <button className="min-h-10 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void close(true)} type="button">{t("shiftScreens.closeAnyway")}</button>
              </> : <button className="min-h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void close(false)} type="button">{busy ? <LoaderCircle className="animate-spin" size={16} /> : t("shiftScreens.confirmClose")}</button>}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SummaryStat({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className={`mt-1 text-xl font-bold text-ink dark:text-white ${valueClass}`}>{value}</p></div>;
}
