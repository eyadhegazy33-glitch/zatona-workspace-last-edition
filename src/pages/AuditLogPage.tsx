import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getAuditActions,
  getAuditUsers,
  getSuspiciousAudit,
  listAuditLogs,
  listAuditScans,
  type AuditFilters,
  type AuditLogRow,
  type AuditScanRow,
  type AuditUser,
} from "../services/auditLog";
import {
  addCalendarDays,
  startOfDateInTimeZone,
} from "../lib/zonedDate";
import { getOperationalRulesSettings } from "../services/settings";
import { useAuth } from "../hooks/useAuth";

type Tab = "activity" | "suspicious" | "scans";

const PAGE_SIZE = 50;
const SECRET_KEY = /(token|secret|password|passwd|authorization|credential|pin|qr)/i;
const TOKEN_VALUE = /^(?:bearer\s+)?(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})$/;

function redactAuditValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return TOKEN_VALUE.test(value.trim()) ? "[REDACTED]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAuditValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactAuditValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

function flattenValue(value: unknown, path = ""): Map<string, unknown> {
  const result = new Map<string, unknown>();
  const safeValue = redactAuditValue(value);
  if (
    safeValue &&
    typeof safeValue === "object" &&
    !Array.isArray(safeValue)
  ) {
    for (const [key, child] of Object.entries(safeValue)) {
      const childPath = path ? `${path}.${key}` : key;
      const nested = flattenValue(child, childPath);
      for (const [nestedKey, nestedValue] of nested) {
        result.set(nestedKey, nestedValue);
      }
    }
    if (result.size === 0 && path) result.set(path, safeValue);
  } else {
    result.set(path || "value", safeValue);
  }
  return result;
}

function displayValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function safeText(value: string | null, key = ""): string {
  const safe = redactAuditValue(value, key);
  return typeof safe === "string" ? safe : safe == null ? "—" : String(safe);
}

function shortAgent(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return value.length > 64 ? `${value.slice(0, 61)}…` : value;
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

function actionTranslationKey(action: string): string {
  return action.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function getSuspiciousReason(row: AuditLogRow, timeZone: string): string {
  const action = row.action.toLowerCase();
  if (action.includes("role") || action.includes("permission")) return "rolePermissions";
  if (action.includes("void") || action.includes("waive")) return "voidWaive";
  const hour = Number(new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(row.created_at)));
  if (
    hour <= 5 &&
    ["delete", "approve", "setting", "suspend"].some((part) => action.includes(part))
  ) return "sensitiveAtNight";
  return "sensitiveChange";
}

function getSummary(row: AuditLogRow, moreLabel: (count: number) => string): string {
  const oldValues = flattenValue(row.old_value);
  const newValues = flattenValue(row.new_value);
  const changedKeys = [...new Set([...oldValues.keys(), ...newValues.keys()])]
    .filter((key) => JSON.stringify(oldValues.get(key)) !== JSON.stringify(newValues.get(key)));
  if (!changedKeys.length) return row.entity_id || "—";
  const visible = changedKeys.slice(0, 3);
  return `${visible.join(", ")}${changedKeys.length > visible.length ? ` ${moreLabel(changedKeys.length - visible.length)}` : ""}`;
}

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const { permissions } = useAuth();
  const canExport = permissions.includes("audit.export");
  const isArabic = i18n.resolvedLanguage?.startsWith("ar") ?? false;
  const [tab, setTab] = useState<Tab>("activity");
  const [filters, setFilters] = useState<AuditFilters>({
    userId: null,
    action: null,
    entity: null,
    from: null,
    to: null,
    search: null,
  });
  const [userFilter, setUserFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [resultFilter, setResultFilter] = useState("");
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [scans, setScans] = useState<AuditScanRow[]>([]);
  const [suspiciousRows, setSuspiciousRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [timeZone, setTimeZone] = useState("Africa/Cairo");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const requestId = useRef(0);

  const formatDate = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(date);
  }, [i18n.language, timeZone]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getAuditActions(),
      getAuditUsers(),
      getOperationalRulesSettings(),
    ]).then(([nextActions, nextUsers, settings]) => {
      if (!active) return;
      setActions(nextActions);
      setUsers(nextUsers);
      setTimeZone(settings.timeZone);
    }).catch(() => {
      if (!active) return;
      setError(t("auditLog.errors.load"));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => ({
        ...current,
        userId: userFilter || null,
        entity: entityFilter.trim() || null,
        search: searchFilter.trim() || null,
        from: fromDate
          ? startOfDateInTimeZone(fromDate, timeZone).toISOString()
          : null,
        to: toDate
          ? startOfDateInTimeZone(addCalendarDays(toDate, 1), timeZone).toISOString()
          : null,
      }));
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [entityFilter, fromDate, searchFilter, timeZone, toDate, userFilter]);

  const loadData = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      if (tab === "activity") {
        const result = await listAuditLogs(filters, PAGE_SIZE, page * PAGE_SIZE);
        if (requestId.current !== currentRequest) return;
        setRows(result.rows);
        setTotal(result.total_count);
      } else if (tab === "scans") {
        const result = await listAuditScans(
          resultFilter || null,
          PAGE_SIZE,
          page * PAGE_SIZE,
        );
        if (requestId.current !== currentRequest) return;
        setScans(result.rows);
        setTotal(result.total_count);
      } else {
        const result = await getSuspiciousAudit(days);
        if (requestId.current !== currentRequest) return;
        setSuspiciousRows(result);
        setTotal(result.length);
      }
    } catch {
      if (requestId.current !== currentRequest) return;
      setError(t("auditLog.errors.load"));
      setRows([]);
      setScans([]);
      setSuspiciousRows([]);
      setTotal(0);
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [days, filters, page, resultFilter, t, tab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedChanges = useMemo(() => {
    if (!selected) return [];
    const oldValues = flattenValue(selected.old_value);
    const newValues = flattenValue(selected.new_value);
    const keys = [...new Set([...oldValues.keys(), ...newValues.keys()])].sort();
    return keys.map((key) => ({
      key,
      oldValue: oldValues.get(key),
      newValue: newValues.get(key),
      changed:
        JSON.stringify(oldValues.get(key)) !== JSON.stringify(newValues.get(key)),
    }));
  }, [selected]);

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    try {
      const currentFilters: AuditFilters = {
        ...filters,
        userId: userFilter || null,
        entity: entityFilter.trim() || null,
        search: searchFilter.trim() || null,
        from: fromDate
          ? startOfDateInTimeZone(fromDate, timeZone).toISOString()
          : null,
        to: toDate
          ? startOfDateInTimeZone(addCalendarDays(toDate, 1), timeZone).toISOString()
          : null,
      };
      const exportRows: AuditLogRow[] = [];
      for (let offset = 0; offset < 5000; offset += PAGE_SIZE) {
        const result = await listAuditLogs(currentFilters, PAGE_SIZE, offset);
        exportRows.push(...result.rows);
        if (exportRows.length >= result.total_count || result.rows.length < PAGE_SIZE) {
          break;
        }
      }
      const headers = [
        "created_at", "actor_name", "actor_role", "action", "entity",
        "entity_id", "ip", "user_agent", "old_value", "new_value",
      ];
      const csv = [
        headers.join(","),
        ...exportRows.map((row) => [
          row.created_at,
          safeText(row.actor_name, "actor_name"),
          safeText(row.actor_role, "actor_role"),
          safeText(row.action, "action"),
          safeText(row.entity, "entity"),
          safeText(row.entity_id, "entity_id"),
          safeText(row.ip, "ip"),
          shortAgent(safeText(row.user_agent, "user_agent"), ""),
          JSON.stringify(redactAuditValue(row.old_value)),
          JSON.stringify(redactAuditValue(row.new_value)),
        ].map(csvCell).join(",")),
      ].join("\r\n");
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], {
        type: "text/csv;charset=utf-8",
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-log.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("auditLog.errors.export"));
    } finally {
      setExporting(false);
    }
  };

  const buttonClass =
    "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
  const inputClass =
    "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

  const renderAuditRows = (items: AuditLogRow[], includeReason = false) => (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full text-start text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
          <tr>
            <th className="px-3 py-3">{t("auditLog.columns.time")}</th>
            <th className="px-3 py-3">{t("auditLog.columns.user")}</th>
            <th className="px-3 py-3">{t("auditLog.columns.role")}</th>
            <th className="px-3 py-3">{t("auditLog.columns.action")}</th>
            <th className="px-3 py-3">{t("auditLog.columns.entity")}</th>
            <th className="px-3 py-3">{t("auditLog.columns.summary")}</th>
            {includeReason && <th className="px-3 py-3">{t("auditLog.suspicious.reason")}</th>}
            <th className="px-3 py-3">{t("auditLog.columns.ip")}</th>
            <th className="px-3 py-3">{t("auditLog.columns.device")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer hover:bg-emerald-50/60 dark:hover:bg-slate-800/70"
              onClick={() => setSelected(row)}
            >
              <td className="whitespace-nowrap px-3 py-3">{formatDate(row.created_at)}</td>
              <td className="px-3 py-3">{row.actor_name ? safeText(row.actor_name, "actor_name") : t("auditLog.unknownUser")}</td>
              <td className="px-3 py-3">{safeText(row.actor_role, "actor_role")}</td>
              <td className="px-3 py-3 font-medium">
                {t(`auditLog.actionNames.${actionTranslationKey(safeText(row.action, "action"))}`, { defaultValue: safeText(row.action, "action") })}
              </td>
              <td className="px-3 py-3">{safeText(row.entity, "entity")}</td>
              <td className="max-w-48 truncate px-3 py-3" title={safeText(getSummary(row, (count) => t("auditLog.summary.more", { count })), "summary")}>
                {safeText(getSummary(row, (count) => t("auditLog.summary.more", { count })), "summary")}
              </td>
              {includeReason && <td className="px-3 py-3"><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t(`auditLog.suspicious.reasons.${getSuspiciousReason(row, timeZone)}`)}</span></td>}
              <td className="px-3 py-3">{safeText(row.ip, "ip")}</td>
              <td className="max-w-40 truncate px-3 py-3" title={safeText(row.user_agent, "user_agent")}>
                {shortAgent(safeText(row.user_agent, "user_agent"), "—")}
              </td>
            </tr>
          ))}
          {!loading && items.length === 0 && (
          <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={includeReason ? 9 : 8}>{t("auditLog.empty")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-5 sm:px-6 lg:px-8" dir={isArabic ? "rtl" : "ltr"}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink dark:text-white">{t("auditLog.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("auditLog.description")}</p>
        </div>
        {canExport && tab === "activity" && (
          <button className={buttonClass} disabled={exporting || loading} onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? t("auditLog.exporting") : t("auditLog.export")}
          </button>
        )}
      </header>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("auditLog.tabs.label")}>
        {(["activity", "suspicious", "scans"] as const).map((value) => (
          <button
            key={value}
            className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold ${tab === value ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"}`}
            onClick={() => { setTab(value); setPage(0); setSelected(null); }}
            aria-pressed={tab === value}
          >
            {t(`auditLog.tabs.${value}`)}
          </button>
        ))}
      </nav>

      {tab === "activity" && (
        <section className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 xl:grid-cols-6" aria-label={t("auditLog.filters.label")}>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.filters.user")}
            <select className={`${inputClass} mt-1`} value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
              <option value="">{t("auditLog.filters.allUsers")}</option>
              {users.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name}{user.role_name ? ` · ${user.role_name}` : ""}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.filters.action")}
            <select className={`${inputClass} mt-1`} value={filters.action ?? ""} onChange={(event) => { setFilters((current) => ({ ...current, action: event.target.value || null })); setPage(0); }}>
              <option value="">{t("auditLog.filters.allActions")}</option>
              {actions.map((action) => <option key={action} value={action}>{t(`auditLog.actionNames.${actionTranslationKey(action)}`, { defaultValue: action })}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.filters.entity")}
            <input className={`${inputClass} mt-1`} value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.filters.from")}
            <input className={`${inputClass} mt-1`} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.filters.to")}
            <input className={`${inputClass} mt-1`} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.filters.search")}
            <span className="relative mt-1 block">
              <Search className={`pointer-events-none absolute top-3 h-4 w-4 text-slate-400 ${isArabic ? "right-3" : "left-3"}`} aria-hidden="true" />
              <input className={`${inputClass} ${isArabic ? "pr-9" : "pl-9"}`} value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} />
            </span>
          </label>
        </section>
      )}

      {tab === "scans" && (
        <div className="mb-4 max-w-xs">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.scans.result")}
            <select className={`${inputClass} mt-1`} value={resultFilter} onChange={(event) => { setResultFilter(event.target.value); setPage(0); }}>
              <option value="">{t("auditLog.scans.allResults")}</option>
              {(["ok", "blocked", "expired", "unknown"] as const).map((result) => <option key={result} value={result}>{t(`auditLog.scans.results.${result}`)}</option>)}
            </select>
          </label>
        </div>
      )}

      {tab === "suspicious" && (
        <div className="mb-4 max-w-xs">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("auditLog.suspicious.period")}
            <select className={`${inputClass} mt-1`} value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {[1, 7, 30].map((period) => <option key={period} value={period}>{t("auditLog.suspicious.days", { count: period })}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span>
          <button className={buttonClass} onClick={() => void loadData()}>{t("auditLog.retry")}</button>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="space-y-3 p-5" aria-label={t("auditLog.loading")}>
            {[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />)}
          </div>
        ) : tab === "scans" ? (
          <div className="overflow-x-auto">
            <table className="min-w-[650px] w-full text-start text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                <tr><th className="px-4 py-3">{t("auditLog.columns.time")}</th><th className="px-4 py-3">{t("auditLog.scans.employee")}</th><th className="px-4 py-3">{t("auditLog.scans.result")}</th><th className="px-4 py-3">{t("auditLog.scans.customer")}</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {scans.map((scan) => <tr key={scan.id}>
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(scan.created_at)}</td>
                  <td className="px-4 py-3">{scan.employee_name ? safeText(scan.employee_name, "employee_name") : t("auditLog.unknownUser")}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${scan.result === "ok" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>{t(`auditLog.scans.results.${scan.result}`)}</span></td>
                  <td className="px-4 py-3">{scan.customer_name ? safeText(scan.customer_name, "customer_name") : (scan.customer_known ? t("auditLog.scans.knownCustomer") : "—")}</td>
                </tr>)}
                {!scans.length && <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={4}>{t("auditLog.empty")}</td></tr>}
              </tbody>
            </table>
          </div>
        ) : tab === "activity" ? renderAuditRows(rows) : (
          <>
            <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800">
              {t("auditLog.suspicious.explanation")}
            </div>
            {renderAuditRows(suspiciousRows, true)}
          </>
        )}
      </section>

      {tab !== "suspicious" && (
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
          <span>{t("auditLog.pagination.count", { count: total })}</span>
          <div className="flex items-center gap-2">
            <button className={buttonClass} disabled={loading || page <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t("auditLog.pagination.previous")}</button>
            <span>{t("auditLog.pagination.page", { page: page + 1, pages: pageCount })}</span>
            <button className={buttonClass} disabled={loading || page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>{t("auditLog.pagination.next")}<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </footer>
      )}

      {tab === "suspicious" && !loading && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{t("auditLog.pagination.count", { count: total })}</p>
      )}

      {selected && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/40" onClick={() => setSelected(null)}>
          <aside
            aria-label={t("auditLog.details.title")}
            aria-modal="true"
            className="h-full w-full max-w-3xl overflow-y-auto bg-white p-4 shadow-xl dark:bg-slate-950 sm:p-6"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink dark:text-white">{t("auditLog.details.title")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t(`auditLog.actionNames.${actionTranslationKey(safeText(selected.action, "action"))}`, { defaultValue: safeText(selected.action, "action") })} · {formatDate(selected.created_at)}</p>
              </div>
              <button className={buttonClass} aria-label={t("auditLog.details.close")} onClick={() => setSelected(null)}><X className="h-4 w-4" /></button>
            </header>
            <dl className="mt-5 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900 sm:grid-cols-2">
              <div><dt className="text-slate-500">{t("auditLog.columns.user")}</dt><dd className="mt-1 font-medium">{safeText(selected.actor_name, "actor_name")}</dd></div>
              <div><dt className="text-slate-500">{t("auditLog.columns.role")}</dt><dd className="mt-1 font-medium">{safeText(selected.actor_role, "actor_role")}</dd></div>
              <div><dt className="text-slate-500">{t("auditLog.columns.entity")}</dt><dd className="mt-1 font-medium">{safeText(selected.entity, "entity")} {selected.entity_id ? `· ${safeText(selected.entity_id, "entity_id")}` : ""}</dd></div>
              <div><dt className="text-slate-500">{t("auditLog.columns.ip")}</dt><dd className="mt-1 font-medium">{safeText(selected.ip, "ip")}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">{t("auditLog.columns.device")}</dt><dd className="mt-1 break-all font-medium">{safeText(selected.user_agent, "user_agent")}</dd></div>
            </dl>
            <div className="mt-5">
              <h3 className="mb-2 font-semibold">{t("auditLog.details.changedFields")}</h3>
              {selectedChanges.length ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full min-w-[560px] text-start text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900"><tr><th className="px-3 py-2">{t("auditLog.details.field")}</th><th className="px-3 py-2">{t("auditLog.details.oldValue")}</th><th className="px-3 py-2">{t("auditLog.details.newValue")}</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedChanges.map((change) => <tr key={change.key} className={change.changed ? "bg-amber-50/70 dark:bg-amber-950/20" : ""}>
                        <th className="px-3 py-2 text-start font-medium">{change.key}</th>
                        <td className="whitespace-pre-wrap break-all px-3 py-2">{displayValue(change.oldValue)}</td>
                        <td className="whitespace-pre-wrap break-all px-3 py-2">{displayValue(change.newValue)}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-900">{t("auditLog.details.noValues")}</p>}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
