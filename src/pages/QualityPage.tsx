import { z } from "zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, ImagePlus, LoaderCircle, XCircle } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  getChecklistQueue,
  submitChecklist,
  uploadChecklistPhoto,
  type QcAnswerInput,
  type QcItem,
  type QcSubmission,
  type QcTemplate,
} from "../services/quality";

type AnswerDraft = {
  passed: boolean | null;
  note: string;
  photoPath: string | null;
  uploading: boolean;
};

const noteSchema = z.string().max(500);

function pageErrorKey(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string" &&
    cause.message.toLowerCase().includes("open shift")
  ) {
    return "quality.errors.shiftRequired";
  }
  return "quality.errors.action";
}

export function QualityPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const requestedTemplateId = searchParams.get("templateId");
  const { profile, permissions } = useAuth();
  const [templates, setTemplates] = useState<QcTemplate[]>([]);
  const [items, setItems] = useState<QcItem[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [hasOpenShift, setHasOpenShift] = useState(false);
  const [timeZone, setTimeZone] = useState("Africa/Cairo");
  const [selected, setSelected] = useState<QcTemplate | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [submission, setSubmission] = useState<QcSubmission | null>(null);
  const [criticalFailure, setCriticalFailure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const autoOpenedTemplateId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setErrorKey(null);
    try {
      const queue = await getChecklistQueue(profile.id);
      setTemplates(queue.templates);
      setItems(queue.items);
      setCompletedIds(queue.completedIds);
      setHasOpenShift(queue.hasOpenShift);
      setTimeZone(queue.timeZone);
    } catch {
      setErrorKey("quality.errors.load");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeItems = useMemo(
    () => selected ? items.filter((item) => item.template_id === selected.id) : [],
    [items, selected],
  );
  const isComplete = selected ? completedIds.has(selected.id) : false;

  const openTemplate = (template: QcTemplate) => {
    setSelected(template);
    setSubmission(null);
    setCriticalFailure(false);
    setErrorKey(null);
    setDrafts(
      Object.fromEntries(
        items
          .filter((item) => item.template_id === template.id)
          .map((item) => [
            item.id,
            { passed: null, note: "", photoPath: null, uploading: false } satisfies AnswerDraft,
          ]),
      ),
    );
  };

  useEffect(() => {
    if (!requestedTemplateId || autoOpenedTemplateId.current === requestedTemplateId) return;
    const template = templates.find((candidate) => candidate.id === requestedTemplateId);
    if (!template) return;
    autoOpenedTemplateId.current = requestedTemplateId;
    openTemplate(template);
  }, [items, requestedTemplateId, templates]);

  const updateDraft = (itemId: string, patch: Partial<AnswerDraft>) => {
    setDrafts((current) => {
      const previous = current[itemId] ?? {
        passed: null,
        note: "",
        photoPath: null,
        uploading: false,
      };
      return { ...current, [itemId]: { ...previous, ...patch } };
    });
  };

  const handlePhoto = async (itemId: string, file?: File) => {
    if (!file) return;
    updateDraft(itemId, { uploading: true });
    setErrorKey(null);
    try {
      const photoPath = await uploadChecklistPhoto(file);
      updateDraft(itemId, { photoPath, uploading: false });
    } catch {
      updateDraft(itemId, { uploading: false });
      setErrorKey("quality.errors.photo");
    }
  };

  const handleSubmit = async () => {
    if (!selected || saving || isComplete || submission) return;
    if (activeItems.some((item) => drafts[item.id]?.passed === null || drafts[item.id]?.uploading)) {
      setErrorKey("quality.errors.answerAll");
      return;
    }
    if (activeItems.some((item) => !noteSchema.safeParse(drafts[item.id]?.note ?? "").success)) {
      setErrorKey("quality.errors.note");
      return;
    }
    const answers: QcAnswerInput[] = activeItems.map((item) => ({
      item_id: item.id,
      passed: drafts[item.id].passed as boolean,
      note: drafts[item.id].note.trim() || null,
      photo_path: drafts[item.id].photoPath,
    }));
    setSaving(true);
    setErrorKey(null);
    try {
      const result = await submitChecklist(selected.id, answers);
      setSubmission(result);
      setCriticalFailure(activeItems.some((item) => item.critical && !drafts[item.id].passed));
      setCompletedIds((current) => new Set(current).add(selected.id));
    } catch (cause) {
      setErrorKey(pageErrorKey(cause));
    } finally {
      setSaving(false);
    }
  };

  const canManage = permissions.includes("qc.manage");
  const canReview = permissions.includes("qc.review");

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink dark:text-white">{t("quality.title")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("quality.description")}</p>
        </div>
        <nav aria-label={t("quality.navigation")} className="flex flex-wrap gap-2">
          {canManage && <Link className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700" to="/quality/checklists">{t("quality.manageTemplates")}</Link>}
          {(canReview || permissions.includes("qc.fill")) && <Link className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700" to="/quality/history">{t("quality.history")}</Link>}
          {canReview && <Link className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700" to="/quality/reports">{t("quality.reports.title")}</Link>}
        </nav>
      </header>

      {errorKey && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t(errorKey)}</p>}
      {loading ? (
        <p className="mt-8 text-sm text-slate-500" role="status">{t("quality.loading")}</p>
      ) : selected ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-ink dark:text-white">{selected.name}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{selected.area}</p>
              </div>
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700" onClick={() => setSelected(null)} type="button">{t("quality.backToList")}</button>
            </div>
            {submission ? (
              <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
                <div className="flex items-center gap-2 text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 aria-hidden="true" size={22} /> {t("quality.submitted")}
                </div>
                <p className="mt-2 text-3xl font-bold text-emerald-900 dark:text-emerald-100">{Number(submission.score).toFixed(2)}%</p>
                {criticalFailure && <p className="mt-3 text-sm font-medium text-amber-900 dark:text-amber-200">{t("quality.criticalIncidentCreated")}</p>}
              </div>
            ) : isComplete ? (
              <p className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{t("quality.alreadyDone")}</p>
            ) : (
              <>
                {selected.frequency === "per_shift" && !hasOpenShift && <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t("quality.openShiftRequired")}</p>}
                <div className="mt-5 space-y-4">
                  {activeItems.map((item) => {
                    const draft = drafts[item.id];
                    return (
                      <article key={item.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="font-semibold text-ink dark:text-white">{item.text}{item.critical && <span className="ms-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">{t("quality.critical")}</span>}</h3>
                          <div className="flex gap-2">
                            <button aria-pressed={draft?.passed === true} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${draft?.passed === true ? "bg-emerald-600 text-white" : "border border-emerald-600 text-emerald-700 dark:text-emerald-300"}`} onClick={() => updateDraft(item.id, { passed: true })} type="button"><CheckCircle2 size={16} />{t("quality.pass")}</button>
                            <button aria-pressed={draft?.passed === false} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${draft?.passed === false ? "bg-red-600 text-white" : "border border-red-600 text-red-700 dark:text-red-300"}`} onClick={() => updateDraft(item.id, { passed: false })} type="button"><XCircle size={16} />{t("quality.fail")}</button>
                          </div>
                        </div>
                        <label className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
                          {t("quality.note")}
                          <textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-3 outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-950" maxLength={500} onChange={(event) => updateDraft(item.id, { note: event.target.value })} value={draft?.note ?? ""} />
                        </label>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
                            <ImagePlus aria-hidden="true" size={16} />{t("quality.takePhoto")}
                            <input
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              disabled={draft?.uploading}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                void handlePhoto(item.id, file);
                              }}
                              type="file"
                            />
                          </label>
                          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
                            {t("quality.choosePhoto")}
                            <input
                              accept="image/*"
                              className="sr-only"
                              disabled={draft?.uploading}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                void handlePhoto(item.id, file);
                              }}
                              type="file"
                            />
                          </label>
                          {draft?.uploading && <LoaderCircle aria-label={t("quality.uploading")} className="animate-spin" size={18} />}
                          {draft?.photoPath && <span className="text-xs text-emerald-700 dark:text-emerald-300">{t("quality.photoAttached")}</span>}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <button className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50" disabled={saving || !activeItems.length || (selected.frequency === "per_shift" && !hasOpenShift) || activeItems.some((item) => drafts[item.id]?.passed === null || drafts[item.id]?.uploading)} onClick={() => void handleSubmit()} type="button">
                  {saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? t("quality.submitting") : t("quality.submit")}
                </button>
              </>
            )}
          </section>
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-semibold text-ink dark:text-white">{t("quality.progress")}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t("quality.progressCount", { answered: activeItems.filter((item) => drafts[item.id]?.passed !== null).length, total: activeItems.length })}</p>
            {selected.due_time && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{t("quality.dueTime", { time: selected.due_time.slice(0, 5), timeZone })}</p>}
          </aside>
        </div>
      ) : (
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold text-ink dark:text-white">{t("quality.toDo")}</h2>
          {templates.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => {
              const done = completedIds.has(template.id);
              return (
                <button key={template.id} className="flex min-h-28 flex-col items-start justify-between rounded-2xl border border-slate-200 bg-white p-4 text-start transition hover:border-brand dark:border-slate-800 dark:bg-slate-900" onClick={() => openTemplate(template)} type="button">
                  <span className="flex items-center gap-2 text-base font-semibold text-ink dark:text-white"><ClipboardList size={18} />{template.name}</span>
                  <span className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <span>{template.frequency === "per_shift" ? t("quality.perShift") : t("quality.daily")}</span>
                    <span className={done ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""}>{done ? t("quality.done") : t("quality.notDone")}</span>
                  </span>
                </button>
              );
            })}
          </div> : <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700">{t("quality.emptyTemplates")}</p>}
        </section>
      )}
    </section>
  );
}
