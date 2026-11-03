import { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  BellRing,
  Check,
  Clock3,
  LoaderCircle,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useAlertOverview } from "../hooks/useAlertOverview";
import { getSupabaseClient } from "../lib/supabase";
import {
  assignAlert,
  getAlertStaff,
  listAlerts,
  resolveAlert,
  type Alert,
  type AlertSeverity,
  type AlertStaff,
  type AlertTab,
} from "../services/alerts";

const severityOrder: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const alertPayloadSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(["critical", "high", "medium", "low"]),
});

function alertSeverityClass(severity: AlertSeverity): string {
  return {
    critical: "border-s-red-600 bg-red-50 dark:border-s-red-500 dark:bg-red-950/30",
    high: "border-s-orange-500 bg-orange-50 dark:border-s-orange-400 dark:bg-orange-950/25",
    medium: "border-s-amber-500 bg-amber-50 dark:border-s-amber-400 dark:bg-amber-950/25",
    low: "border-s-emerald-500 bg-emerald-50 dark:border-s-emerald-400 dark:bg-emerald-950/25",
  }[severity];
}

function severityBadgeClass(severity: AlertSeverity): string {
  return {
    critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    high: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
    medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  }[severity];
}

function statusBadgeClass(status: Alert["status"]): string {
  return {
    open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    acknowledged: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    snoozed: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  }[status];
}

function detailString(alert: Alert, field: string): string | null {
  const detail: unknown = alert.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail) || !(field in detail)) {
    return null;
  }
  const value = Object.entries(detail).find(([key]) => key === field)?.[1];
  return typeof value === "string" ? value : null;
}

function relatedPath(alert: Alert, permissions: string[]): string | null {
  if (alert.type === "overdue") {
    const customerId = detailString(alert, "customer_id");
    if (customerId && permissions.includes("customers.view")) return `/customers/${customerId}`;
    if (permissions.includes("timers.view")) return "/timers";
    return null;
  }
  if (alert.type === "low_stock") {
    const itemId = detailString(alert, "item_id");
    return itemId && permissions.includes("inventory.view")
      ? `/inventory?item=${encodeURIComponent(itemId)}`
      : null;
  }
  if (alert.type === "shift_open" || alert.type === "cash_difference") {
    const sessionId = detailString(alert, "session_id");
    return sessionId ? `/alerts/shift-session/${sessionId}` : null;
  }
  if (alert.type === "critical_incident") {
    const incidentId = detailString(alert, "incident_id");
    return incidentId && permissions.includes("incidents.view")
      ? `/incidents/${incidentId}`
      : null;
  }
  if (alert.type === "missed_checklist") {
    const templateId = detailString(alert, "template_id");
    return templateId && permissions.includes("qc.fill")
      ? `/quality?templateId=${encodeURIComponent(templateId)}`
      : null;
  }
  if (alert.type === "scan_failures") return `/alerts/scan-log/${alert.id}`;
  return null;
}

function translatedAlertTitle(alert: Alert, t: (key: string, options?: Record<string, unknown>) => string): string {
  const suffix = alert.title.includes(":") ? alert.title.slice(alert.title.indexOf(":") + 1).trim() : "";
  switch (alert.type) {
    case "overdue":
    case "shift_open":
    case "cash_difference":
    case "scan_failures":
      return t(`alerts.titles.${alert.type}`);
    case "low_stock":
      return t("alerts.titles.low_stock", { item: suffix || t("alerts.types.low_stock") });
    case "critical_incident":
      return t("alerts.titles.critical_incident", { incident: suffix || t("alerts.types.critical_incident") });
    case "missed_checklist":
      return t("alerts.titles.missed_checklist", { checklist: suffix || t("alerts.types.missed_checklist") });
    default:
      return alert.title;
  }
}

function timeSince(createdAt: string, language: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (seconds < 60) return formatter.format(-seconds, "second");
  if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), "hour");
  return formatter.format(-Math.floor(seconds / 86400), "day");
}

function readStoredMute(): boolean {
  try {
    return localStorage.getItem("zatona.alerts.muted") === "true";
  } catch {
    return false;
  }
}

async function playCriticalTone(): Promise<boolean> {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return false;
  const context = new AudioContextConstructor();
  try {
    await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.46);
    await new Promise<void>((resolve) => {
      oscillator.addEventListener("ended", () => resolve(), { once: true });
    });
    return true;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}

const tabs: AlertTab[] = ["active", "snoozed", "resolved"];

export function AlertsPage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const canViewAll = permissions.includes("alerts.view");
  const canViewAssigned = permissions.includes("alerts.view_assigned");
  const canManage = permissions.includes("alerts.manage");
  const { overview, error: overviewError, retry: retryOverview } = useAlertOverview(
    canViewAll,
  );
  const [tab, setTab] = useState<AlertTab>("active");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [staff, setStaff] = useState<AlertStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [staffError, setStaffError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Record<string, string>>({});
  const [muted, setMuted] = useState(readStoredMute);
  const [soundUnavailable, setSoundUnavailable] = useState(false);
  const seenIds = useRef(new Set<string>());
  const hasLoaded = useRef(false);
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(false);
    try {
      const rows = await listAlerts(tab);
      setAlerts(rows);
      if (!hasLoaded.current) {
        seenIds.current = new Set(rows.map((row) => row.id));
        hasLoaded.current = true;
      } else {
        rows.forEach((row) => seenIds.current.add(row.id));
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!canManage) return;
    void getAlertStaff()
      .then((members) => {
        setStaff(members);
        setStaffError(false);
      })
      .catch(() => setStaffError(true));
  }, [canManage]);

  useEffect(() => {
    let debounce: number | undefined;
    let channel: RealtimeChannel | null = null;
    const client = getSupabaseClient();
    channel = client
      .channel(`alerts-center-${crypto.randomUUID()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "alerts",
      }, (payload) => {
        if (payload.eventType === "INSERT" && hasLoaded.current && !muted) {
          const parsed = alertPayloadSchema.safeParse(payload.new);
          if (parsed.success && parsed.data.severity === "critical" && !seenIds.current.has(parsed.data.id)) {
            seenIds.current.add(parsed.data.id);
            void playCriticalTone().then((played) => {
              if (!played) setSoundUnavailable(true);
            });
          }
        }
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => {
          void refresh(false);
          void retryOverview();
        }, 300);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLoadError(true);
      });

    return () => {
      window.clearTimeout(debounce);
      if (channel) void client.removeChannel(channel);
    };
  }, [muted, refresh, retryOverview]);

  useEffect(() => {
    if (tab !== "snoozed") return;
    const nextExpiry = alerts.reduce<number | null>((earliest, alert) => {
      if (!alert.snoozed_until) return earliest;
      const expiration = new Date(alert.snoozed_until).getTime();
      return earliest === null || expiration < earliest ? expiration : earliest;
    }, null);
    if (nextExpiry === null) return;
    const timer = window.setTimeout(
      () => {
        void refresh(false);
        void retryOverview();
      },
      Math.max(0, nextExpiry - Date.now() + 500),
    );
    return () => window.clearTimeout(timer);
  }, [alerts, retryOverview, refresh, tab]);

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [alerts],
  );
  const staffById = useMemo(() => new Map(staff.map((member) => [member.user_id, member])), [staff]);

  const runAction = async (alertId: string, action: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(alertId);
    setActionError(false);
    try {
      await action();
      await refresh(false);
      await retryOverview();
    } catch {
      setActionError(true);
    } finally {
      setBusyId(null);
    }
  };

  const assignSelectedStaff = (alertId: string, userId: string) => {
    if (!userId) return;
    void runAction(alertId, async () => {
      await assignAlert(alertId, userId);
      setSelectedStaff((current) => {
        const next = { ...current };
        delete next[alertId];
        return next;
      });
    });
  };

  const toggleMute = async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    try {
      localStorage.setItem("zatona.alerts.muted", String(nextMuted));
    } catch {
      setSoundUnavailable(true);
    }
    if (!nextMuted) {
      const played = await playCriticalTone();
      setSoundUnavailable(!played);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink dark:text-white">
            <BellRing aria-hidden="true" className="text-brand" size={24} />
            {t(canViewAssigned && !canViewAll ? "alerts.myTasksTitle" : "alerts.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {t(canViewAssigned && !canViewAll ? "alerts.myTasksDescription" : "alerts.description")}
          </p>
        </div>
        <button
          aria-pressed={muted}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => void toggleMute()}
          type="button"
        >
          {muted ? <VolumeX aria-hidden="true" size={17} /> : <Volume2 aria-hidden="true" size={17} />}
          {t(muted ? "alerts.sound.unmute" : "alerts.sound.mute")}
        </button>
      </header>

      {canViewAll && overviewError && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert">{t("alerts.errors.overview")} <button className="ms-2 font-semibold underline" onClick={() => void retryOverview()} type="button">{t("alerts.actions.retry")}</button></p>}
      {soundUnavailable && !muted && <p className="mt-4 text-sm text-amber-700 dark:text-amber-300" role="status">{t("alerts.sound.unavailable")}</p>}
      {actionError && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("alerts.errors.action")}</p>}
      {staffError && <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="alert">{t("alerts.errors.staff")}</p>}

      {canViewAll && <div aria-label={t("alerts.severityCounts")} className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" role="group">
        {(["critical", "high", "medium", "low"] as const).map((severity) => (
          <div className={`rounded-xl border-s-4 bg-white p-4 shadow-sm dark:bg-slate-900 ${alertSeverityClass(severity)}`} key={severity}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{t(`alerts.severities.${severity}`)}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink dark:text-white">{overview?.[`${severity}_count`] ?? "—"}</p>
          </div>
        ))}
      </div>}

      {canViewAll && <div className="mt-6 border-b border-slate-200 dark:border-slate-800">
        <div aria-label={t("alerts.tabs.label")} className="flex gap-2 overflow-x-auto" role="tablist">
          {tabs.map((value) => (
            <button
              aria-selected={tab === value}
              className={`min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold ${
                tab === value
                  ? "border-brand text-brand"
                  : "border-transparent text-slate-600 hover:text-ink dark:text-slate-300 dark:hover:text-white"
              }`}
              key={value}
              onClick={() => setTab(value)}
              role="tab"
              type="button"
            >
              {t(`alerts.tabs.${value}`)}
            </button>
          ))}
        </div>
      </div>}

      {tab !== "resolved" && (
        <p className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
          {t(canManage
            ? tab === "snoozed" ? "alerts.help.assignSnoozed" : "alerts.help.assign"
            : "alerts.help.resolve")}
        </p>
      )}

      {loadError && <p className="mt-5 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">{t("alerts.errors.load")} <button className="ms-2 font-semibold underline" onClick={() => void refresh()} type="button">{t("alerts.actions.retry")}</button></p>}
      {loading ? (
        <p className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500" role="status"><LoaderCircle className="animate-spin" size={18} />{t("alerts.loading")}</p>
      ) : sortedAlerts.length === 0 && !loadError ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{t(`alerts.empty.${tab}`)}</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {sortedAlerts.map((alert) => {
            const destination = relatedPath(alert, permissions);
            const assigned = alert.assigned_to ? staffById.get(alert.assigned_to) : null;
            const title = translatedAlertTitle(alert, t);
            const selectedEmployeeId = selectedStaff[alert.id] ?? alert.assigned_to ?? "";
            const resolvedByStaff = alert.resolved_by ? staffById.get(alert.resolved_by) : undefined;
            const resolvedBy = alert.resolved_by
              ? alert.resolved_by === profile?.id && profile
                ? `${profile.first_name} ${profile.last_name}`.trim()
                : resolvedByStaff
                  ? `${resolvedByStaff.first_name} ${resolvedByStaff.last_name}`.trim()
                  : t("alerts.assigned")
              : null;
            return (
              <li className={`rounded-xl border border-slate-200 border-s-4 p-4 shadow-sm dark:border-slate-800 sm:p-5 ${alertSeverityClass(alert.severity)}`} key={alert.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${severityBadgeClass(alert.severity)}`}>{t(`alerts.severities.${alert.severity}`)}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(alert.status)}`}>{t(`alerts.statuses.${alert.status}`)}</span>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(`alerts.types.${alert.type}`, { defaultValue: t("alerts.types.other") })}</span>
                    </div>
                    <h2 className="mt-2 break-words text-base font-semibold text-ink dark:text-white">{title}</h2>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                      <Clock3 aria-hidden="true" size={14} />
                      <time dateTime={alert.created_at}>{timeSince(alert.created_at, i18n.language)}</time>
                    </p>
                    {alert.status === "snoozed" && alert.snoozed_until && (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t("alerts.snoozedUntil", { time: new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(new Date(alert.snoozed_until)) })}</p>
                    )}
                    {alert.type === "cash_difference" && alert.status !== "resolved" && (
                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{t("alerts.help.cashDifference")}</p>
                    )}
                    {alert.assigned_to && (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {alert.assigned_to === profile?.id
                          ? t("alerts.assignedToYou")
                          : t("alerts.assignedTo", {
                            name: assigned
                              ? `${assigned.first_name} ${assigned.last_name}`.trim()
                              : t("alerts.assigned"),
                          })}
                      </p>
                    )}
                    {resolvedBy && alert.status === "resolved" && (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {t("alerts.actions.resolvedBy", { name: resolvedBy })}
                      </p>
                    )}
                  </div>
                  {destination && <Link className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-brand px-3 text-sm font-semibold text-brand hover:bg-white/70 dark:hover:bg-slate-900" to={destination}>{t("alerts.actions.openRelated")}</Link>}
                </div>

                {(canManage || alert.assigned_to === profile?.id) && alert.status !== "resolved" && (
                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700 sm:flex-row sm:flex-wrap sm:items-center">
                    {canManage && (
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <select
                          aria-label={t("alerts.actions.assign")}
                          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
                          disabled={busyId === alert.id || staff.length === 0}
                          onChange={(event) => setSelectedStaff((current) => ({
                            ...current,
                            [alert.id]: event.target.value,
                          }))}
                          value={selectedEmployeeId}
                        >
                          <option value="">{t("alerts.actions.chooseStaff")}</option>
                          {staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.first_name} {member.last_name}{member.role_name ? ` · ${member.role_name}` : ""}</option>)}
                        </select>
                        <button
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
                          disabled={busyId === alert.id || !selectedEmployeeId}
                          onClick={() => assignSelectedStaff(alert.id, selectedEmployeeId)}
                          type="button"
                        >
                          {busyId === alert.id ? <LoaderCircle className="animate-spin" size={16} /> : <Check aria-hidden="true" size={16} />}
                          {t("alerts.actions.assign")}
                        </button>
                      </div>
                    )}
                    {alert.assigned_to === profile?.id && (
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={busyId === alert.id}
                        onClick={() => void runAction(alert.id, () => resolveAlert(alert.id))}
                        type="button"
                      >
                        {busyId === alert.id ? <LoaderCircle className="animate-spin" size={16} /> : <Check aria-hidden="true" size={16} />}
                        {t("alerts.actions.markResolved")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
