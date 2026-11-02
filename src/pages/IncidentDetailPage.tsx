import { z } from "zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, LoaderCircle, MessageSquare, UserRound } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  addIncidentComment,
  assignIncident,
  loadIncident,
  loadIncidentStaff,
  updateIncidentStatus,
  type Incident,
  type IncidentStaff,
  type IncidentStatus,
  type IncidentTimelineEvent,
} from "../services/incidents";

type DetailData = {
  incident: Incident;
  events: IncidentTimelineEvent[];
  signedPhotos: string[];
};

const commentSchema = z.string().trim().min(1).max(1000);
const resolutionSchema = z.string().trim().min(3).max(2000);

function transitionOptions(
  status: IncidentStatus,
  canManage: boolean,
  isAssignee: boolean,
): IncidentStatus[] {
  if (canManage) {
    const options: Record<IncidentStatus, IncidentStatus[]> = {
      open: ["assigned", "in_progress", "resolved"],
      assigned: ["in_progress", "resolved"],
      in_progress: ["resolved"],
      resolved: ["closed", "in_progress"],
      closed: [],
    };
    return options[status];
  }
  if (isAssignee && (status === "open" || status === "assigned")) {
    return ["in_progress", "resolved"];
  }
  if (isAssignee && status === "in_progress") return ["resolved"];
  return [];
}

function timelineBody(event: IncidentTimelineEvent, t: (key: string) => string): string {
  if (event.kind === "created") return event.body ?? t("incidents.timeline.created");
  if (event.kind === "assign") return event.assigned_name ?? t("incidents.timeline.assigned");
  if (event.kind === "status") {
    const separator = event.body?.indexOf(":") ?? -1;
    const status = separator >= 0 ? event.body?.slice(0, separator) : event.body ?? "";
    const note = separator >= 0 ? event.body?.slice(separator + 1).trim() : "";
    const label = t(`incidents.statuses.${status}`);
    return note ? `${label} — ${note}` : label;
  }
  return event.body ?? "";
}

export function IncidentDetailPage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const { incidentId = "" } = useParams();
  const canManage = permissions.includes("incidents.manage");
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [staff, setStaff] = useState<IncidentStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [staffError, setStaffError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<IncidentStatus | "">("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [comment, setComment] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const result = await loadIncident(incidentId);
      setDetail(result);
      setSelectedAssignee(result.incident.assigned_to ?? "");
    } catch {
      setActionError("incidents.errors.details");
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!canManage) return;
    void loadIncidentStaff().then(setStaff).catch(() => setStaffError(true));
  }, [canManage]);

  const incident = detail?.incident;
  const isReporterOrAssignee = Boolean(
    incident && profile &&
    (incident.reported_by === profile.id || incident.assigned_to === profile.id),
  );
  const canComment = canManage || isReporterOrAssignee;
  const assignedName =
    staff.find((member) => member.user_id === incident?.assigned_to)
      ? `${staff.find((member) => member.user_id === incident?.assigned_to)?.first_name} ${staff.find((member) => member.user_id === incident?.assigned_to)?.last_name}`
      : [...(detail?.events ?? [])].reverse().find((event) => event.kind === "assign")?.assigned_name;
  const nextStatuses = useMemo(
    () => incident ? transitionOptions(incident.status, canManage, incident.assigned_to === profile?.id) : [],
    [canManage, incident, profile?.id],
  );

  const performAction = async (action: () => Promise<void>, success?: () => void) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      success?.();
      await refresh();
    } catch (cause) {
      const message = cause && typeof cause === "object" && "message" in cause ? String(cause.message).toLowerCase() : "";
      setActionError(message.includes("not allowed") ? "incidents.errors.permission" : "incidents.errors.action");
    } finally {
      setBusy(false);
    }
  };

  const submitAssignment = () => {
    if (!incident || !selectedAssignee) {
      setActionError("incidents.errors.selectAssignee");
      return;
    }
    void performAction(() => assignIncident(incident.id, selectedAssignee));
  };

  const submitStatus = () => {
    if (!incident || !selectedStatus) return;
    if (
      (selectedStatus === "resolved" || selectedStatus === "closed") &&
      !resolutionSchema.safeParse(resolutionNote).success
    ) {
      setActionError("incidents.errors.resolutionNote");
      return;
    }
    void performAction(
      () => updateIncidentStatus(incident.id, selectedStatus, resolutionNote),
      () => {
        setSelectedStatus("");
        setResolutionNote("");
      },
    );
  };

  const submitComment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!incident) return;
    if (!commentSchema.safeParse(comment).success) {
      setActionError("incidents.errors.comment");
      return;
    }
    void performAction(
      () => addIncidentComment(incident.id, comment),
      () => setComment(""),
    );
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Link className="text-sm font-semibold text-brand hover:underline" to="/incidents">{t("incidents.backToList")}</Link>
      {actionError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t(actionError)} <button className="ms-2 font-semibold underline" onClick={() => void refresh()} type="button">{t("incidents.actions.retry")}</button></p>}
      {loading ? <p className="mt-6 text-sm text-slate-500" role="status">{t("incidents.loading")}</p> : !incident ? (
        <p className="mt-6 rounded-xl border border-slate-200 p-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">{t("incidents.errors.notFound")}</p>
      ) : (
        <>
          {incident.severity === "critical" && <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100"><AlertTriangle className="mt-0.5 shrink-0" size={21} /><div><p className="font-bold">{t("incidents.criticalBanner.title")}</p><p className="mt-1 text-sm">{t("incidents.criticalBanner.description")}</p></div></div>}
          <header className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-start sm:justify-between sm:p-6">
            <div className="min-w-0">
              <p className="font-mono text-sm text-slate-500">#{incident.number}</p>
              <h1 className="mt-1 break-words text-2xl font-semibold text-ink dark:text-white">{incident.title}</h1>
              <p className="mt-2 text-sm text-slate-500">{t(`incidents.types.${incident.type}`)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(incident.created_at))}{incident.location ? ` · ${incident.location}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${incident.severity === "critical" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : incident.severity === "high" ? "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200" : incident.severity === "medium" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>{t(`incidents.severities.${incident.severity}`)}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{t(`incidents.statuses.${incident.status}`)}</span>
            </div>
          </header>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
            <div className="space-y-4">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
                <h2 className="font-semibold text-ink dark:text-white">{t("incidents.detail.description")}</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{incident.description || t("incidents.noDescription")}</p>
              </article>
              {detail.signedPhotos.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
                <h2 className="font-semibold text-ink dark:text-white">{t("incidents.detail.photos")}</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {detail.signedPhotos.map((url, index) => <a className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700" href={url} key={`${url}-${index}`} rel="noreferrer" target="_blank"><img alt={t("incidents.detail.photoAlt", { count: index + 1 })} className="aspect-square w-full object-cover" loading="lazy" src={url} /></a>)}
                </div>
              </section>}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
                <h2 className="flex items-center gap-2 font-semibold text-ink dark:text-white"><MessageSquare size={18} />{t("incidents.detail.timeline")}</h2>
                <ol className="mt-4 space-y-4">
                  {detail.events.map((event) => (
                    <li className="relative border-s-2 border-slate-200 ps-4 dark:border-slate-700" key={event.event_id}>
                      <span className="absolute -start-[5px] top-1 h-2 w-2 rounded-full bg-brand" />
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t(`incidents.timeline.kinds.${event.kind}`)}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{timelineBody(event, t)}</p>
                      <p className="mt-1 text-xs text-slate-500">{event.actor_name || t("incidents.timeline.unknownUser")} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}</p>
                    </li>
                  ))}
                </ol>
                {canComment && <form className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800" onSubmit={submitComment}>
                  <label className="block text-sm font-medium">{t("incidents.detail.addComment")}<textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={1000} onChange={(event) => setComment(event.target.value)} value={comment} /></label>
                  <button className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || !comment.trim()} type="submit">{busy && <LoaderCircle className="animate-spin" size={16} />}{t("incidents.detail.postComment")}</button>
                </form>}
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="flex items-center gap-2 font-semibold text-ink dark:text-white"><UserRound size={18} />{t("incidents.detail.assignment")}</h2>
                <p className="mt-2 break-words text-sm text-slate-500">{incident.assigned_to ? assignedName ?? t("incidents.detail.assigned") : t("incidents.detail.unassigned")}</p>
                {canManage && incident.status !== "closed" && <div className="mt-3 space-y-2">
                  <label className="block text-sm font-medium">{t("incidents.detail.assignTo")}
                    <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setSelectedAssignee(event.target.value)} value={selectedAssignee}>
                      <option value="">{t("incidents.detail.selectStaff")}</option>
                      {staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.first_name} {member.last_name}{member.role_name ? ` · ${member.role_name}` : ""}</option>)}
                    </select>
                  </label>
                  {staffError && <p className="text-xs text-red-700 dark:text-red-300">{t("incidents.errors.staff")}</p>}
                  <button className="min-h-10 w-full rounded-lg border border-brand px-3 text-sm font-semibold text-brand disabled:opacity-60" disabled={busy || !selectedAssignee || selectedAssignee === incident.assigned_to} onClick={submitAssignment} type="button">{t("incidents.detail.assign")}</button>
                </div>}
              </section>
              {nextStatuses.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="font-semibold text-ink dark:text-white">{t("incidents.detail.updateStatus")}</h2>
                <label className="mt-3 block text-sm font-medium">{t("incidents.fields.status")}
                  <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setSelectedStatus(event.target.value as IncidentStatus | "")} value={selectedStatus}>
                    <option value="">{t("incidents.detail.selectStatus")}</option>
                    {nextStatuses.map((status) => <option key={status} value={status}>{t(`incidents.statuses.${status}`)}</option>)}
                  </select>
                </label>
                {(selectedStatus === "resolved" || selectedStatus === "closed") && <label className="mt-3 block text-sm font-medium">{t("incidents.detail.resolutionNote")}<textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={2000} onChange={(event) => setResolutionNote(event.target.value)} value={resolutionNote} /></label>}
                <button className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || !selectedStatus} onClick={submitStatus} type="button">{busy && <LoaderCircle className="animate-spin" size={16} />}<CheckCircle2 size={16} />{t("incidents.detail.saveStatus")}</button>
              </section>}
              {incident.resolution_note && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"><h2 className="font-semibold text-emerald-900 dark:text-emerald-200">{t("incidents.detail.resolution")}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900 dark:text-emerald-100">{incident.resolution_note}</p></section>}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
