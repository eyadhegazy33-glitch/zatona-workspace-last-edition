import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LoaderCircle, Star } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { getOperationalRulesSettings } from "../services/settings";
import {
  formatLocalDate,
  loadSubmission,
  loadSubmissionHistory,
  reviewSubmission,
  type QcSubmission,
} from "../services/quality";

type HistoryEntry = {
  submission: QcSubmission;
  templateName: string;
  employeeName: string;
  shiftName: string | null;
};

type SubmissionDetail = Awaited<ReturnType<typeof loadSubmission>>;

const reviewFormSchema = z.object({
  score: z.number().int().min(1).max(5),
  note: z.string().trim().max(500),
});

export function QualityHistoryPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [timeZone, setTimeZone] = useState("Africa/Cairo");
  const [score, setScore] = useState(5);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [reviewSaved, setReviewSaved] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const [history, settings] = await Promise.all([
        loadSubmissionHistory(),
        getOperationalRulesSettings(),
      ]);
      setRows(history);
      setTimeZone(settings.timeZone);
    } catch {
      setErrorKey("quality.errors.history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setErrorKey(null);
    setReviewSaved(false);
    try {
      setDetail(await loadSubmission(id));
    } catch {
      setErrorKey("quality.errors.details");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleReview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || savingReview) return;
    const parsed = reviewFormSchema.safeParse({ score, note });
    if (!parsed.success) {
      setErrorKey("quality.errors.reviewValidation");
      return;
    }
    setSavingReview(true);
    setErrorKey(null);
    try {
      await reviewSubmission(detail.submission.id, parsed.data.score, parsed.data.note);
      setDetail((current) => current ? {
        ...current,
        submission: {
          ...current.submission,
          reviewed_at: new Date().toISOString(),
          review_score: parsed.data.score,
          review_note: parsed.data.note || null,
        },
      } : current);
      setRows((current) => current.map((entry) => entry.submission.id === detail.submission.id
        ? { ...entry, submission: { ...entry.submission, reviewed_at: new Date().toISOString(), review_score: parsed.data.score, review_note: parsed.data.note || null } }
        : entry));
      setReviewSaved(true);
    } catch {
      setErrorKey("quality.errors.review");
    } finally {
      setSavingReview(false);
    }
  };

  const canReview = permissions.includes("qc.review");
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <Link className="text-sm font-semibold text-brand hover:underline" to="/quality">{t("quality.backToQuality")}</Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink dark:text-white">{t("quality.history")}</h1>
      </header>
      {errorKey && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t(errorKey)}</p>}
      {reviewSaved && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" role="status">{t("quality.reviewSaved")}</p>}
      {loading ? <p className="mt-6 text-sm text-slate-500" role="status">{t("quality.loading")}</p> : (
        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-start text-sm">
                  <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-3 font-medium">{t("quality.table.template")}</th>
                      <th className="px-3 py-3 font-medium">{t("quality.table.employee")}</th>
                      <th className="px-3 py-3 font-medium">{t("quality.table.shift")}</th>
                      <th className="px-3 py-3 font-medium">{t("quality.table.date")}</th>
                      <th className="px-3 py-3 font-medium">{t("quality.table.score")}</th>
                      <th className="px-3 py-3 font-medium">{t("quality.table.review")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map(({ submission, templateName, employeeName, shiftName }) => (
                      <tr className={selectedId === submission.id ? "bg-brand/5" : ""} key={submission.id}>
                        <td className="px-3 py-3"><button className="text-start font-semibold text-brand hover:underline" onClick={() => void openDetail(submission.id)} type="button">{templateName || t("quality.unknownTemplate")}</button></td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{employeeName || t("quality.unknownEmployee")}</td>
                        <td className="px-3 py-3 text-slate-500">{submission.shift_session_id ? shiftName ?? t("quality.table.shiftLinked") : t("quality.table.daily")}</td>
                        <td className="px-3 py-3 text-slate-500">{formatLocalDate(submission.submitted_at, timeZone, i18n.language)}</td>
                        <td className="px-3 py-3 font-semibold">{Number(submission.score).toFixed(1)}%</td>
                        <td className="px-3 py-3">{submission.reviewed_at ? t("quality.reviewed") : t("quality.awaitingReview")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="p-6 text-sm text-slate-500">{t("quality.noSubmissions")}</p>}
          </div>

          <section className="min-h-48 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            {!selectedId ? <p className="text-sm text-slate-500">{t("quality.selectSubmission")}</p> : detailLoading ? <p className="flex items-center gap-2 text-sm text-slate-500" role="status"><LoaderCircle className="animate-spin" size={16} />{t("quality.loadingDetails")}</p> : detail && (
              <>
                <h2 className="text-lg font-semibold text-ink dark:text-white">{detail.template?.name ?? t("quality.unknownTemplate")}</h2>
                <p className="mt-1 text-sm text-slate-500">{detail.employeeName} · {formatLocalDate(detail.submission.submitted_at, timeZone, i18n.language)}</p>
                <p className="mt-2 text-sm font-semibold text-brand">{t("quality.scoreLabel", { score: Number(detail.submission.score).toFixed(1) })}</p>
                <div className="mt-4 space-y-3">
                  {detail.answers.map((answer) => (
                    <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" key={answer.id}>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-medium text-ink dark:text-white">{answer.item_text}{answer.critical && <span className="ms-2 text-xs font-semibold text-red-700 dark:text-red-300">{t("quality.critical")}</span>}</h3>
                        <span className={answer.passed ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>{answer.passed ? t("quality.pass") : t("quality.fail")}</span>
                      </div>
                      {answer.note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{answer.note}</p>}
                      {answer.photo_path && <a className="mt-2 inline-flex text-sm font-semibold text-brand underline" href={answer.photo_path} rel="noreferrer" target="_blank">{t("quality.viewPhoto")}</a>}
                    </article>
                  ))}
                </div>
                {canReview && !detail.submission.reviewed_at && (
                  <form className="mt-5 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" onSubmit={(event) => void handleReview(event)}>
                    <h3 className="font-semibold text-ink dark:text-white">{t("quality.addReview")}</h3>
                    <label className="block text-sm font-medium">{t("quality.reviewScore")}
                      <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setScore(Number(event.target.value))} value={score}>
                        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">{t("quality.reviewNote")}<textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} /></label>
                    <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={savingReview} type="submit">{savingReview && <LoaderCircle className="animate-spin" size={16} />}<Star size={16} />{savingReview ? t("quality.saving") : t("quality.submitReview")}</button>
                  </form>
                )}
                {detail.submission.reviewed_at && <div className="mt-5 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950"><p className="font-semibold">{t("quality.reviewScore")}: {detail.submission.review_score} / 5</p>{detail.submission.review_note && <p className="mt-1">{detail.submission.review_note}</p>}</div>}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
