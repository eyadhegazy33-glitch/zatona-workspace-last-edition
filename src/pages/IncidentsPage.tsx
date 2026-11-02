import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { getSupabaseClient } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import {
  listIncidents,
  type Incident,
  type IncidentFilters,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
} from "../services/incidents";

const initialFilters: IncidentFilters = {
  status: "",
  severity: "",
  type: "",
  assignedToMe: false,
  from: "",
  to: "",
  search: "",
};

const statuses: IncidentStatus[] = ["open", "assigned", "in_progress", "resolved", "closed"];
const severities: IncidentSeverity[] = ["low", "medium", "high", "critical"];
const types: IncidentType[] = ["equipment", "customer", "cash", "safety", "cleaning", "quality", "power_internet", "other"];

function badgeClass(severity: IncidentSeverity): string {
  return {
    low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    high: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
    critical: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  }[severity];
}

function statusClass(status: IncidentStatus): string {
  return {
    open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    assigned: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    closed: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  }[status];
}

function filteredSearch(rows: Incident[], search: string): Incident[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return rows;
  return rows.filter((incident) =>
    [incident.title, incident.description, incident.location]
      .some((value) => value?.toLocaleLowerCase().includes(term)),
  );
}

export function IncidentsPage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const canViewAll = permissions.includes("incidents.view");
  const canReport = permissions.includes("incidents.report");
  const [filters, setFilters] = useState<IncidentFilters>(initialFilters);
  const serverFilters = useMemo(() => ({ ...filters, search: "" }), [
    filters.assignedToMe,
    filters.from,
    filters.severity,
    filters.status,
    filters.to,
    filters.type,
  ]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoadError(false);
    try {
      const rows = await listIncidents(serverFilters, profile.id);
      setIncidents(rows);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [profile, serverFilters]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const client = getSupabaseClient();
    const channel = client
      .channel(`incidents-list-${profile?.id ?? "staff"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void refresh(), 900);
      })
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [profile?.id, refresh]);

  const visibleIncidents = useMemo(
    () => filteredSearch(incidents, filters.search),
    [filters.search, incidents],
  );
  const setFilter = <K extends keyof IncidentFilters>(key: K, value: IncidentFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink dark:text-white">{t("incidents.title")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t(canViewAll ? "incidents.descriptionAll" : "incidents.descriptionMine")}</p>
        </div>
        {canReport && <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white" to="/incidents/new"><Plus size={17} />{t("incidents.new.action")}</Link>}
      </header>

      <section aria-label={t("incidents.filters.label")} className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative block sm:col-span-2 lg:col-span-4">
          <span className="sr-only">{t("incidents.filters.search")}</span>
          <Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input className="min-h-11 w-full rounded-lg border border-slate-300 bg-white ps-10 pe-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFilter("search", event.target.value)} placeholder={t("incidents.filters.search")} value={filters.search} />
        </label>
        <label className="text-sm font-medium">{t("incidents.filters.status")}
          <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFilter("status", event.target.value as IncidentStatus | "")} value={filters.status}>
            <option value="">{t("incidents.filters.all")}</option>{statuses.map((status) => <option key={status} value={status}>{t(`incidents.statuses.${status}`)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{t("incidents.filters.severity")}
          <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFilter("severity", event.target.value as IncidentSeverity | "")} value={filters.severity}>
            <option value="">{t("incidents.filters.all")}</option>{severities.map((severity) => <option key={severity} value={severity}>{t(`incidents.severities.${severity}`)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{t("incidents.filters.type")}
          <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFilter("type", event.target.value as IncidentType | "")} value={filters.type}>
            <option value="">{t("incidents.filters.all")}</option>{types.map((type) => <option key={type} value={type}>{t(`incidents.types.${type}`)}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">{t("incidents.filters.from")}
          <input className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFilter("from", event.target.value)} type="date" value={filters.from} />
        </label>
        <label className="text-sm font-medium">{t("incidents.filters.to")}
          <input className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFilter("to", event.target.value)} type="date" value={filters.to} />
        </label>
        <label className="inline-flex min-h-10 items-center gap-2 text-sm font-medium sm:col-span-2">
          <input checked={filters.assignedToMe} onChange={(event) => setFilter("assignedToMe", event.target.checked)} type="checkbox" />
          {t("incidents.filters.assignedToMe")}
        </label>
      </section>

      {loadError && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t("incidents.errors.load")} <button className="ms-2 font-semibold underline" onClick={() => { setLoading(true); void refresh(); }} type="button">{t("incidents.actions.retry")}</button></p>}
      <section aria-label={t("incidents.results")} className="mt-5">
        {loading ? <p className="rounded-xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-800" role="status">{t("incidents.loading")}</p> : visibleIncidents.length ? (
          <div className="grid gap-3">
            {visibleIncidents.map((incident) => (
              <Link className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand dark:border-slate-800 dark:bg-slate-900" key={incident.id} to={`/incidents/${incident.id}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words font-semibold text-ink group-hover:text-brand dark:text-white">{incident.title}</h2>
                      <span className="font-mono text-xs text-slate-500">#{incident.number}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{incident.description || t("incidents.noDescription")}</p>
                    <p className="mt-2 text-xs text-slate-500">{t(`incidents.types.${incident.type}`)}{incident.location ? ` · ${incident.location}` : ""} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(incident.created_at))}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass(incident.severity)}`}>{incident.severity === "critical" && <AlertTriangle size={13} />}{t(`incidents.severities.${incident.severity}`)}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(incident.status)}`}>{t(`incidents.statuses.${incident.status}`)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">{t("incidents.empty")}</p>}
      </section>
    </section>
  );
}
