import { ArrowUpRight, DoorClosed, LoaderCircle, RefreshCw, Timer, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useLiveTimers } from "../hooks/useLiveTimers";
import { checkOutVisit } from "../services/timers";
import type { LiveTimer } from "../services/timers";
import { CheckoutDialog } from "../components/CheckoutDialog";
import type { CheckoutTicket } from "../services/pointOfSale";
import { CustomerPaymentDialog } from "./CustomerCheckoutPage";
import {
  getSecondsLeft,
  getTimerState,
  type TimerState,
} from "../lib/timerMath";

type CheckoutPrompt = { customerId: string; amount: number } | null;

function formatDuration(seconds: number): string {
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const rest = absolute % 60;
  return `${seconds < 0 ? "+" : ""}${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${rest.toString().padStart(2, "0")}`;
}

function playOverdueAlert(audio: AudioContext): Promise<void> {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 740;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(audio.destination);
  return new Promise<void>((resolve, reject) => {
    oscillator.addEventListener(
      "ended",
      () => {
        resolve();
      },
      { once: true },
    );
    try {
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.35);
    } catch (error) {
      reject(error);
    }
  });
}

export function TimersPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const navigate = useNavigate();
  const { timers, serverOffsetMs, now, loading, error, refresh } =
    useLiveTimers();
  const [muted, setMuted] = useState(true);
  const [soundError, setSoundError] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [actionError, setActionError] = useState(false);
  const [notice, setNotice] = useState("");
  const [checkoutPrompt, setCheckoutPrompt] = useState<CheckoutPrompt>(null);
  const [checkoutCheckinId, setCheckoutCheckinId] = useState<number | null>(null);
  const [paymentCustomerId, setPaymentCustomerId] = useState<string | null>(null);
  const previousOverdue = useRef<Set<number>>(new Set());
  const overdueInitialized = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const canCheckOut = permissions.includes("checkins.manage");
  const canCreateOrders =
    permissions.includes("orders.create") || permissions.includes("orders.manage");
  const canCollectPayment = permissions.includes("payments.collect");
  const canOpenCustomer = permissions.includes("customers.view");
  const locale = i18n.language.startsWith("ar") ? "ar-EG" : i18n.language;

  const rows = useMemo(
    () =>
      timers
        .map((timer) => ({
          timer,
          state: getTimerState(timer.deadline, timer.warning_at, now, serverOffsetMs),
          secondsLeft: getSecondsLeft(timer.deadline, now, serverOffsetMs),
        }))
        .sort((left, right) => left.secondsLeft - right.secondsLeft),
    [now, serverOffsetMs, timers],
  );
  const summary = useMemo(
    () => ({
      inside: rows.length,
      warning: rows.filter((row) => row.state === "warning").length,
      overdue: rows.filter((row) => row.state === "overdue").length,
    }),
    [rows],
  );

  useEffect(() => {
    const overdueIds = new Set(
      rows.filter((row) => row.state === "overdue").map((row) => row.timer.checkin_id),
    );
    if (overdueInitialized.current && !muted) {
      const newlyOverdue = [...overdueIds].some((id) => !previousOverdue.current.has(id));
      if (newlyOverdue && audioContext.current) {
        void playOverdueAlert(audioContext.current).then(
          () => setSoundError(false),
          () => setSoundError(true),
        );
      }
    }
    previousOverdue.current = overdueIds;
    overdueInitialized.current = true;
  }, [muted, rows]);

  useEffect(
    () => () => {
      if (audioContext.current && audioContext.current.state !== "closed") {
        void audioContext.current.close();
      }
    },
    [],
  );

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );

  const checkOut = async (timer: LiveTimer) => {
    if (actionId !== null) return;
    if (canCheckOut && permissions.includes("orders.manage")) {
      setCheckoutCheckinId(timer.checkin_id);
      return;
    }
    setActionId(timer.checkin_id);
    setActionError(false);
    setNotice("");
    try {
      const result = await checkOutVisit(timer.checkin_id);
      await refresh();
      if (result.fees_due > 0) {
        setCheckoutPrompt({
          customerId: result.customer_id,
          amount: result.fees_due,
        });
      } else {
        setNotice(t("timers.checkedOut"));
      }
    } catch {
      setActionError(true);
    } finally {
      setActionId(null);
    }
  };

  const stateClasses: Record<TimerState, string> = {
    ok: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
    warning: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
    overdue: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  };
  const stateTextClasses: Record<TimerState, string> = {
    ok: "text-emerald-800 dark:text-emerald-200",
    warning: "text-amber-800 dark:text-amber-200",
    overdue: "text-red-800 dark:text-red-200",
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">
            {t("timers.eyebrow")}
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-bold tracking-tight text-ink dark:text-white sm:text-4xl">
            <Timer aria-hidden="true" size={30} />
            {t("timers.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t("timers.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            aria-pressed={!muted}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
            onClick={() => {
              setSoundError(false);
              if (muted) {
                try {
                  audioContext.current = new AudioContext();
                  void audioContext.current.resume().then(
                    () => setMuted(false),
                    () => setSoundError(true),
                  );
                } catch {
                  setSoundError(true);
                }
              } else {
                setMuted(true);
                if (audioContext.current?.state !== "closed") {
                  void audioContext.current?.close();
                }
                audioContext.current = null;
              }
            }}
            type="button"
          >
            {muted ? <VolumeX aria-hidden="true" size={18} /> : <Volume2 aria-hidden="true" size={18} />}
            {t(muted ? "timers.sound.enable" : "timers.sound.mute")}
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-60"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={17} />
            {t("timers.refresh")}
          </button>
        </div>
      </header>

      {soundError && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          {t("timers.sound.unavailable")}
        </p>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          <p>{t("timers.errors.load")}</p>
          <button className="mt-2 font-semibold underline" onClick={() => void refresh()} type="button">
            {t("timers.retry")}
          </button>
        </div>
      )}
      {actionError && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          {t("timers.errors.checkout")}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" role="status">
          {notice}
        </p>
      )}

      {(!error || timers.length > 0) && (
        <section aria-label={t("timers.summary.title")} className="grid gap-3 sm:grid-cols-3">
          {([
            ["inside", summary.inside, "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"],
            ["warning", summary.warning, "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"],
            ["overdue", summary.overdue, "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"],
          ] as const).map(([key, count, color]) => (
            <article className={`rounded-2xl border p-4 sm:p-5 ${color}`} key={key}>
              <p className="text-sm font-semibold">{t(`timers.summary.${key}`)}</p>
              <p className="mt-1 text-4xl font-bold tabular-nums">{count}</p>
            </article>
          ))}
        </section>
      )}

      {error && timers.length === 0 ? null : loading && timers.length === 0 ? (
        <div className="grid min-h-40 place-items-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <LoaderCircle aria-label={t("timers.loading")} className="animate-spin text-brand" size={26} />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {t("timers.empty")}
        </p>
      ) : (
        <section aria-label={t("timers.title")} className="space-y-3">
          {rows.map(({ timer, state, secondsLeft }) => (
            <article
              className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${stateClasses[state]}`}
              key={timer.checkin_id}
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,0.8fr)_minmax(12rem,0.8fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <p className="truncate text-xl font-bold text-ink dark:text-white sm:text-2xl">
                    {timer.customer_name}
                  </p>
                  <p className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">
                    {timer.customer_code}
                  </p>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {timer.resource_name || t("timers.noResource")}
                  </p>
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200">
                  <p className="font-semibold">{t("timers.enteredAt")}</p>
                  <p className="mt-1">{formatDateTime(timer.checked_in_at)}</p>
                </div>
                <div className={stateTextClasses[state]}>
                  <p className="text-sm font-semibold">{t(`timers.state.${state}`)}</p>
                  <p className="mt-1 font-mono text-2xl font-bold tabular-nums sm:text-3xl">
                    {formatDuration(secondsLeft)}
                  </p>
                  <p className="mt-1 text-sm">
                    {t("timers.feesDue", { amount: formatMoney(timer.fees_due) })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 xl:justify-end">
                  {canCreateOrders && (
                    <button
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-3 text-sm font-semibold text-white"
                      onClick={() => navigate("/orders/new", { state: { customerId: timer.customer_id, checkinId: timer.checkin_id } })}
                      type="button"
                    >
                      {t("timers.actions.newOrder")}
                    </button>
                  )}
                  {canCollectPayment && (
                    <button
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      onClick={() => setPaymentCustomerId(timer.customer_id)}
                      type="button"
                    >
                      {t("timers.actions.collectPayment")}
                    </button>
                  )}
                  {canCheckOut && (
                    <button
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      disabled={actionId !== null}
                      onClick={() => void checkOut(timer)}
                      type="button"
                    >
                      {actionId === timer.checkin_id
                        ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
                        : <DoorClosed aria-hidden="true" size={16} />}
                      {t("timers.actions.checkOut")}
                    </button>
                  )}
                  {canOpenCustomer && (
                    <Link
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"
                      to={`/customers/${timer.customer_id}`}
                    >
                      <ArrowUpRight aria-hidden="true" size={16} />
                      {t("timers.actions.openCustomer")}
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {checkoutPrompt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation">
          <section
            aria-labelledby="timer-checkout-prompt-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
            role="alertdialog"
          >
            <h2 className="text-xl font-bold text-ink dark:text-white" id="timer-checkout-prompt-title">
              {t("timers.checkoutPrompt", { amount: formatMoney(checkoutPrompt.amount) })}
            </h2>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold dark:border-slate-700"
                onClick={() => setCheckoutPrompt(null)}
                type="button"
              >
                {t("timers.dismiss")}
              </button>
              {canCollectPayment && (
                <button
                  className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white"
                  onClick={() => {
                    setPaymentCustomerId(checkoutPrompt.customerId);
                    setCheckoutPrompt(null);
                  }}
                  type="button"
                >
                  {t("timers.actions.collectPayment")}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {checkoutCheckinId !== null && (
        <CheckoutDialog
          checkinId={checkoutCheckinId}
          onClose={() => setCheckoutCheckinId(null)}
          onComplete={(ticket: CheckoutTicket) => {
            setNotice(t("timers.checkoutPaid", {
              ticket: ticket.ticket_no,
              amount: formatMoney(ticket.total),
            }));
            void refresh();
          }}
        />
      )}
      {paymentCustomerId && (
        <CustomerPaymentDialog
          customerId={paymentCustomerId}
          onClose={() => setPaymentCustomerId(null)}
        />
      )}
    </main>
  );
}
