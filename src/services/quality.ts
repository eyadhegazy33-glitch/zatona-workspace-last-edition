import { z } from "zod";
import { getSupabaseClient } from "../lib/supabase";
import { getOperationalRulesSettings } from "./settings";

export type QcTemplate = {
  id: string;
  name: string;
  area: string | null;
  frequency: "per_shift" | "daily";
  due_time: string | null;
  active: boolean;
  created_at: string;
};

export type QcItem = {
  id: string;
  template_id: string;
  text: string;
  critical: boolean;
  sort: number;
  active: boolean;
};

export type QcSubmission = {
  id: string;
  template_id: string;
  user_id: string;
  shift_session_id: string | null;
  submitted_at: string;
  total_items: number;
  passed_items: number;
  score: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_score: number | null;
  review_note: string | null;
};

export type QcAnswerInput = {
  item_id: string;
  passed: boolean;
  note: string | null;
  photo_path: string | null;
};

export type QcTemplateInput = {
  name: string;
  area: string | null;
  frequency: "per_shift" | "daily";
  due_time: string | null;
};

export type QcItemInput = {
  id?: string;
  text: string;
  critical: boolean;
  sort: number;
  active: boolean;
};

const checklistAnswersSchema = z.array(
  z.object({
    item_id: z.string().uuid(),
    passed: z.boolean(),
    note: z.string().max(500).nullable(),
    photo_path: z.string().max(500).nullable(),
  }),
);

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  area: z.string().trim().max(120).nullable(),
  frequency: z.enum(["per_shift", "daily"]),
  due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
}).refine((value) => value.frequency !== "daily" || value.due_time !== null, {
  path: ["due_time"],
});

const templateItemsSchema = z.array(
  z.object({
    id: z.string().uuid().optional(),
    text: z.string().trim().min(1).max(300),
    critical: z.boolean(),
    sort: z.number().int().nonnegative(),
    active: z.boolean(),
  }),
).min(1);

const reviewSchema = z.object({
  score: z.number().int().min(1).max(5),
  note: z.string().trim().max(500),
});

const feedbackSchema = z.object({
  customerId: z.string().uuid().nullable(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500),
});

const feedbackSummarySchema = z.object({
  average_rating: z.number(),
  feedback_count: z.number(),
  latest_comments: z.array(z.object({
    rating: z.number(),
    comment: z.string().nullable(),
    created_at: z.string(),
  })),
});

function throwOnError(error: { message: string } | null): void {
  if (error) throw error;
}

function requireData<T>(data: T | null): T {
  if (data === null) throw new Error("The quality request returned no data.");
  return data;
}

async function fetchInChunks<T>(
  ids: string[],
  fetch: (chunk: string[]) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await fetch(ids.slice(offset, offset + 100));
    throwOnError(result.error);
    rows.push(...requireData(result.data));
  }
  return rows;
}

function localDateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function getChecklistQueue(userId: string): Promise<{
  templates: QcTemplate[];
  items: QcItem[];
  completedIds: Set<string>;
  hasOpenShift: boolean;
  timeZone: string;
}> {
  const client = getSupabaseClient();
  const [templateResult, shiftResult, settings] = await Promise.all([
    client.from("qc_templates").select("*").eq("active", true).order("name"),
    client
      .from("shift_sessions")
      .select("id, opened_at")
      .eq("user_id", userId)
      .is("closed_at", null)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getOperationalRulesSettings(),
  ]);
  throwOnError(templateResult.error);
  throwOnError(shiftResult.error);

  const templates = requireData(templateResult.data);
  const currentShift = shiftResult.data;
  if (!templates.length) {
    return {
      templates,
      items: [],
      completedIds: new Set(),
      hasOpenShift: Boolean(currentShift),
      timeZone: settings.timeZone,
    };
  }
  const ids = templates.map((template) => template.id);
  const [itemResult, submissionResult] = await Promise.all([
    client
      .from("qc_template_items")
      .select("*")
      .in("template_id", ids)
      .eq("active", true)
      .order("sort"),
    client
      .from("qc_submissions")
      .select("template_id, shift_session_id, submitted_at")
      .eq("user_id", userId)
      .gte("submitted_at", new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()),
  ]);
  throwOnError(itemResult.error);
  throwOnError(submissionResult.error);

  const activeItems = requireData(itemResult.data);
  const submissions = requireData(submissionResult.data);
  const today = localDateKey(new Date(), settings.timeZone);
  const completedIds = new Set(
    templates
      .filter((template) =>
        submissions.some((submission) =>
          submission.template_id === template.id &&
          (template.frequency === "per_shift"
            ? Boolean(currentShift) && submission.shift_session_id === currentShift?.id
            : localDateKey(new Date(submission.submitted_at), settings.timeZone) === today),
        ),
      )
      .map((template) => template.id),
  );
  return {
    templates,
    items: activeItems,
    completedIds,
    hasOpenShift: Boolean(currentShift),
    timeZone: settings.timeZone,
  };
}

export async function submitChecklist(
  templateId: string,
  answers: QcAnswerInput[],
): Promise<QcSubmission> {
  const validAnswers = checklistAnswersSchema.parse(answers);
  const { data, error } = await getSupabaseClient().rpc("submit_checklist", {
    p_template: templateId,
    p_answers: validAnswers,
  });
  throwOnError(error);
  return requireData(data);
}

export async function loadTemplatesForManagement(): Promise<{
  templates: QcTemplate[];
  items: QcItem[];
}> {
  const client = getSupabaseClient();
  const [templateResult, itemResult] = await Promise.all([
    client.from("qc_templates").select("*").order("name"),
    client.from("qc_template_items").select("*").order("sort"),
  ]);
  throwOnError(templateResult.error);
  throwOnError(itemResult.error);
  return {
    templates: requireData(templateResult.data),
    items: requireData(itemResult.data),
  };
}

export async function saveChecklistTemplate(
  templateId: string | null,
  input: QcTemplateInput,
  items: QcItemInput[],
): Promise<void> {
  const template = templateSchema.parse(input);
  const validItems = templateItemsSchema.parse(items);
  const client = getSupabaseClient();
  let savedId = templateId;
  if (savedId) {
    const { error } = await client
      .from("qc_templates")
      .update(template)
      .eq("id", savedId);
    throwOnError(error);
  } else {
    const { data, error } = await client
      .from("qc_templates")
      .insert(template)
      .select("id")
      .single();
    throwOnError(error);
    savedId = requireData(data).id;
  }

  for (const [index, item] of validItems.entries()) {
    const values = {
      template_id: savedId,
      text: item.text.trim(),
      critical: item.critical,
      sort: index,
      active: item.active,
    };
    if (item.id) {
      const { error } = await client
        .from("qc_template_items")
        .update(values)
        .eq("id", item.id)
        .eq("template_id", savedId);
      throwOnError(error);
    } else {
      const { error } = await client.from("qc_template_items").insert(values);
      throwOnError(error);
    }
  }
}

export async function setChecklistActive(
  templateId: string,
  active: boolean,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("qc_templates")
    .update({ active })
    .eq("id", templateId);
  throwOnError(error);
}

export async function loadSubmission(submissionId: string): Promise<{
  submission: QcSubmission;
  answers: Array<QcAnswerInput & { item_text: string; critical: boolean; id: number }>;
  template: QcTemplate | null;
  employeeName: string;
}> {
  const client = getSupabaseClient();
  const { data: submission, error: submissionError } = await client
    .from("qc_submissions")
    .select("*")
    .eq("id", submissionId)
    .single();
  throwOnError(submissionError);
  const savedSubmission = requireData(submission);
  const [answerResult, templateResult, employeeResult] = await Promise.all([
    client.from("qc_answers").select("*").eq("submission_id", submissionId).order("id"),
    client.from("qc_templates").select("*").eq("id", savedSubmission.template_id).maybeSingle(),
    client.rpc("get_qc_employee_names", { p_user_ids: [savedSubmission.user_id] }),
  ]);
  throwOnError(answerResult.error);
  throwOnError(templateResult.error);
  throwOnError(employeeResult.error);
  const employee = requireData(employeeResult.data)[0];
  const answers = requireData(answerResult.data);
  const paths = answers.flatMap((answer) => answer.photo_path ? [answer.photo_path] : []);
  const signedUrls = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await client.storage
      .from("attachments")
      .createSignedUrls(paths, 60);
    throwOnError(error);
    requireData(data).forEach((entry, index) => {
      if (!entry.signedUrl) throw new Error("Could not sign an attached checklist photo.");
      signedUrls.set(paths[index], entry.signedUrl);
    });
  }
  return {
    submission: savedSubmission,
    answers: answers.map((answer) => ({
      item_id: answer.item_id ?? "",
      item_text: answer.item_text,
      critical: answer.critical,
      passed: answer.passed,
      note: answer.note,
      photo_path: answer.photo_path ? signedUrls.get(answer.photo_path) ?? null : null,
      id: answer.id,
    })),
    template: templateResult.data,
    employeeName: employee
      ? `${employee.first_name} ${employee.last_name}`.trim()
      : "",
  };
}

export async function loadSubmissionHistory(): Promise<Array<{
  submission: QcSubmission;
  templateName: string;
  employeeName: string;
  shiftName: string | null;
}>> {
  const client = getSupabaseClient();
  const { data: submissions, error } = await client
    .from("qc_submissions")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(500);
  throwOnError(error);
  const records = requireData(submissions);
  if (!records.length) return [];
  const templateIds = [...new Set(records.map((row) => row.template_id))];
  const userIds = [...new Set(records.map((row) => row.user_id))];
  const shiftSessionIds = [...new Set(records.flatMap((row) => row.shift_session_id ? [row.shift_session_id] : []))];
  const [templatesResult, profilesResult, shiftsResult] = await Promise.all([
    client.from("qc_templates").select("id, name").in("id", templateIds),
    client.rpc("get_qc_employee_names", { p_user_ids: userIds }),
    shiftSessionIds.length
      ? client.rpc("get_qc_shift_names", { p_shift_session_ids: shiftSessionIds })
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwOnError(templatesResult.error);
  throwOnError(profilesResult.error);
  throwOnError(shiftsResult.error);
  const templates = new Map(requireData(templatesResult.data).map((row) => [row.id, row.name]));
  const profiles = new Map(requireData(profilesResult.data).map((row) => [
    row.user_id,
    `${row.first_name} ${row.last_name}`.trim(),
  ]));
  const shiftNames = new Map(requireData(shiftsResult.data).map((row) => [
    row.shift_session_id,
    row.shift_name,
  ]));
  return records.map((submission) => ({
    submission,
    templateName: templates.get(submission.template_id) ?? "",
    employeeName: profiles.get(submission.user_id) ?? "",
    shiftName: submission.shift_session_id
      ? shiftNames.get(submission.shift_session_id) ?? null
      : null,
  }));
}

export async function reviewSubmission(
  submissionId: string,
  score: number,
  note: string,
): Promise<void> {
  const review = reviewSchema.parse({ score, note });
  const { error } = await getSupabaseClient().rpc("review_submission", {
    p_id: submissionId,
    p_score: review.score,
    p_note: review.note || null,
  });
  throwOnError(error);
}

export async function recordCustomerFeedback(
  customerId: string | null,
  rating: number,
  comment: string,
): Promise<void> {
  const input = feedbackSchema.parse({ customerId, rating, comment });
  const { error } = await getSupabaseClient().rpc("add_feedback", {
    p_customer: input.customerId,
    p_rating: input.rating,
    p_comment: input.comment || null,
  });
  throwOnError(error);
}

export async function uploadChecklistPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("invalid_image");
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new Error("image_too_large");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_processing_failed");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("image_processing_failed")),
        "image/jpeg",
        0.82,
      );
    });
    if (blob.size > 5 * 1024 * 1024) throw new Error("image_too_large");
    const path = `qc/${crypto.randomUUID()}/photo.jpg`;
    const { error } = await getSupabaseClient()
      .storage
      .from("attachments")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    throwOnError(error);
    return path;
  } finally {
    bitmap.close();
  }
}

export async function loadQualityReports(
  includeFeedback: boolean,
): Promise<{
  submissions: Array<QcSubmission & { templateName: string; employeeName: string }>;
  answers: Array<{ item_text: string; critical: boolean; passed: boolean }>;
  feedback: Array<{ rating: number; comment: string | null; created_at: string }>;
  feedbackAverage: number | null;
  feedbackCount: number;
}> {
  const client = getSupabaseClient();
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const rawSubmissions: QcSubmission[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await client
      .from("qc_submissions")
      .select("*")
      .gte("submitted_at", from.toISOString())
      .order("submitted_at", { ascending: true })
      .range(offset, offset + 999);
    throwOnError(page.error);
    const pageRows = requireData(page.data);
    rawSubmissions.push(...pageRows);
    if (pageRows.length < 1000) break;
  }
  const records = requireData(rawSubmissions);
  const templateIds = [...new Set(records.map((row) => row.template_id))];
  const userIds = [...new Set(records.map((row) => row.user_id))];
  const submissionIds = records.map((row) => row.id);
  const [templateRows, employeeRows, answerRows] = await Promise.all([
    fetchInChunks(templateIds, (ids) =>
      client.from("qc_templates").select("id, name").in("id", ids)),
    fetchInChunks(userIds, (ids) =>
      client.rpc("get_qc_employee_names", { p_user_ids: ids })),
    fetchInChunks(submissionIds, (ids) =>
      client.from("qc_answers").select("item_text, critical, passed").in("submission_id", ids)),
  ]);
  let feedbackAverage: number | null = null;
  let feedbackCount = 0;
  let feedback: Array<{ rating: number; comment: string | null; created_at: string }> = [];
  if (includeFeedback) {
    const { data, error: feedbackError } = await client.rpc("get_quality_feedback_summary");
    throwOnError(feedbackError);
    const summary = feedbackSummarySchema.parse(requireData(data?.[0] ?? null));
    feedbackAverage = summary.feedback_count ? summary.average_rating : null;
    feedbackCount = summary.feedback_count;
    feedback = summary.latest_comments;
  }
  const templates = new Map(templateRows.map((row) => [row.id, row.name]));
  const profiles = new Map(employeeRows.map((row) => [
    row.user_id,
    `${row.first_name} ${row.last_name}`.trim(),
  ]));
  return {
    submissions: rawSubmissions.map((row) => ({
      ...row,
      templateName: templates.get(row.template_id) ?? "",
      employeeName: profiles.get(row.user_id) ?? "",
    })),
    answers: answerRows,
    feedback,
    feedbackAverage,
    feedbackCount,
  };
}

export function formatLocalDate(value: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

export function getLocalWeekKey(value: string, timeZone: string): string {
  const localKey = localDateKey(new Date(value), timeZone);
  const localDate = new Date(`${localKey}T12:00:00Z`);
  const weekOffset = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - weekOffset);
  return localDate.toISOString().slice(0, 10);
}
