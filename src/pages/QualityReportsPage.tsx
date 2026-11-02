import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getOperationalRulesSettings } from "../services/settings";
import {
  getLocalWeekKey,
  loadQualityReports,
  type QcSubmission,
} from "../services/quality";

type ReportSubmission = QcSubmission & {
  templateName: string;
  employeeName: string;
};

const chartColors = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626"];

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function QualityReportsPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const canViewFeedback = permissions.includes("feedback.view");
  const [submissions, setSubmissions] = useState<ReportSubmission[]>([]);
  const [answers, setAnswers] = useState<Array<{ item_text: string; critical: boolean; passed: boolean }>>([]);
  const [feedback, setFeedback] = useState<Array<{ rating: number; comment: string | null; created_at: string }>>([]);
  const [feedbackAverage, setFeedbackAverage] = useState<number | null>(null);
  const [timeZone, setTimeZone] = useState("Africa/Cairo");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const settings = await getOperationalRulesSettings();
      const data = await loadQualityReports(canViewFeedback);
      setTimeZone(settings.timeZone);
      setSubmissions(data.submissions);
      setAnswers(data.answers);
      setFeedback(data.feedback);
      setFeedbackAverage(data.feedbackAverage);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [canViewFeedback]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const weeklyScores = useMemo(() => {
    const groups = new Map<string, Map<string, number[]>>();
    for (const row of submissions) {
      const week = getLocalWeekKey(row.submitted_at, timeZone);
      const byTemplate = groups.get(week) ?? new Map<string, number[]>();
      const scores = byTemplate.get(row.templateName) ?? [];
      scores.push(Number(row.score));
      byTemplate.set(row.templateName, scores);
      groups.set(week, byTemplate);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([week, byTemplate]) => {
      const point: Record<string, string | number> = {
        week: new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${week}T12:00:00Z`)),
      };
      byTemplate.forEach((scores, template) => { point[template] = Number(average(scores).toFixed(1)); });
      return point;
    });
  }, [i18n.language, submissions, timeZone]);

  const employeeScores = useMemo(() => {
    const byEmployee = new Map<string, number[]>();
    for (const row of submissions) {
      const scores = byEmployee.get(row.employeeName) ?? [];
      scores.push(Number(row.score));
      byEmployee.set(row.employeeName, scores);
    }
    return [...byEmployee.entries()]
      .map(([employee, scores]) => ({ employee, average: Number(average(scores).toFixed(1)) }))
      .sort((left, right) => right.average - left.average)
      .slice(0, 20);
  }, [submissions]);

  const failedItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const answer of answers) {
      if (!answer.passed) counts.set(answer.item_text, (counts.get(answer.item_text) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([item, failures]) => ({ item, failures }))
      .sort((left, right) => right.failures - left.failures)
      .slice(0, 10);
  }, [answers]);

  const criticalFailures = answers.filter((answer) => answer.critical && !answer.passed).length;
  const chartCard = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5";
  const axisColor = "#64748b";

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <Link className="text-sm font-semibold text-brand hover:underline" to="/quality">{t("quality.backToQuality")}</Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink dark:text-white">{t("quality.reports.title")}</h1>
      </header>
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t("quality.errors.reports")}</p>}
      {loading ? <p className="mt-6 text-sm text-slate-500" role="status">{t("quality.loading")}</p> : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className={chartCard}><p className="text-sm text-slate-500">{t("quality.reports.submissions")}</p><p className="mt-2 text-3xl font-bold text-ink dark:text-white">{submissions.length}</p></article>
            <article className={chartCard}><p className="text-sm text-slate-500">{t("quality.reports.averageScore")}</p><p className="mt-2 text-3xl font-bold text-ink dark:text-white">{submissions.length ? `${average(submissions.map((row) => Number(row.score))).toFixed(1)}%` : "—"}</p></article>
            <article className={chartCard}><p className="text-sm text-slate-500">{t("quality.reports.criticalFailures")}</p><p className="mt-2 text-3xl font-bold text-red-700 dark:text-red-300">{criticalFailures}</p></article>
            {canViewFeedback && <article className={chartCard}><p className="text-sm text-slate-500">{t("quality.reports.feedbackAverage")}</p><p className="mt-2 text-3xl font-bold text-ink dark:text-white">{feedbackAverage === null ? "—" : `${feedbackAverage.toFixed(1)} / 5`}</p></article>}
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <article className={chartCard}>
              <h2 className="mb-4 font-semibold text-ink dark:text-white">{t("quality.reports.weeklyChecklistScores")}</h2>
              {weeklyScores.length ? <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyScores} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" tick={{ fill: axisColor, fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    {[...new Set(submissions.map((row) => row.templateName))].map((template, index) => <Line connectNulls dataKey={template} dot={false} key={template} name={template} stroke={chartColors[index % chartColors.length]} type="monotone" />)}
                  </LineChart>
                </ResponsiveContainer>
              </div> : <p className="py-12 text-center text-sm text-slate-500">{t("quality.reports.noData")}</p>}
            </article>
            <article className={chartCard}>
              <h2 className="mb-4 font-semibold text-ink dark:text-white">{t("quality.reports.employeeScores")}</h2>
              {employeeScores.length ? <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={employeeScores} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="employee" tick={{ fill: axisColor, fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={55} />
                    <YAxis domain={[0, 100]} tick={{ fill: axisColor, fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="average" fill="#315c45" name={t("quality.reports.averageScore")} />
                  </BarChart>
                </ResponsiveContainer>
              </div> : <p className="py-12 text-center text-sm text-slate-500">{t("quality.reports.noData")}</p>}
            </article>
            <article className={`${chartCard} xl:col-span-2`}>
              <h2 className="mb-4 font-semibold text-ink dark:text-white">{t("quality.reports.topFailedItems")}</h2>
              {failedItems.length ? <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={failedItems} layout="vertical" margin={{ top: 8, right: 20, bottom: 8, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis allowDecimals={false} tick={{ fill: axisColor, fontSize: 12 }} type="number" />
                    <YAxis dataKey="item" type="category" width={150} tick={{ fill: axisColor, fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="failures" fill="#dc2626" name={t("quality.reports.failures")} />
                  </BarChart>
                </ResponsiveContainer>
              </div> : <p className="py-12 text-center text-sm text-slate-500">{t("quality.reports.noData")}</p>}
            </article>
            {canViewFeedback && <article className={`${chartCard} xl:col-span-2`}>
              <h2 className="font-semibold text-ink dark:text-white">{t("quality.reports.latestFeedback")}</h2>
              {feedback.length ? <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                {feedback.map((entry) => <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between" key={`${entry.created_at}-${entry.rating}`}>
                  <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{entry.comment || t("quality.reports.noComment")}</p>
                  <span className="shrink-0 text-sm font-semibold text-amber-700 dark:text-amber-300">{entry.rating} / 5</span>
                </div>)}
              </div> : <p className="mt-3 text-sm text-slate-500">{t("quality.reports.noFeedback")}</p>}
            </article>}
          </div>
        </>
      )}
    </section>
  );
}
