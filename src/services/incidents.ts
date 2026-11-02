import { z } from "zod";
import { getSupabaseClient } from "../lib/supabase";

export type IncidentType =
  | "equipment"
  | "customer"
  | "cash"
  | "safety"
  | "cleaning"
  | "quality"
  | "power_internet"
  | "other";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";
export type Incident = {
  id: string;
  number: number;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  location: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  photo_paths: string[];
  source: string;
  qc_submission_id: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
};

export type IncidentTimelineEvent = {
  event_id: number;
  kind: "created" | "comment" | "status" | "assign";
  body: string | null;
  created_at: string;
  actor_name: string | null;
  assigned_name: string | null;
};

export type IncidentStaff = {
  user_id: string;
  first_name: string;
  last_name: string;
  role_name: string | null;
};

export type IncidentFilters = {
  status: IncidentStatus | "";
  severity: IncidentSeverity | "";
  type: IncidentType | "";
  assignedToMe: boolean;
  from: string;
  to: string;
  search: string;
};

const incidentReportSchema = z.object({
  type: z.enum(["equipment", "customer", "cash", "safety", "cleaning", "quality", "power_internet", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  location: z.string().trim().max(200),
  photoPaths: z.array(z.string().max(500)).max(5),
});

const statusSchema = z.object({
  incidentId: z.string().uuid(),
  status: z.enum(["assigned", "in_progress", "resolved", "closed"]),
  note: z.string().trim().max(2000),
});

const commentSchema = z.object({
  incidentId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
});
const assignmentSchema = z.object({
  incidentId: z.string().uuid(),
  userId: z.string().uuid(),
});

function throwOnError(error: { message: string } | null): void {
  if (error) throw error;
}

function requireData<T>(data: T | null): T {
  if (data === null) throw new Error("The incident request returned no data.");
  return data;
}

function escapeSearchTerm(value: string): string {
  return value.replace(/[\\%_,()."]/g, "\\$&");
}

export async function createIncident(input: {
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
  location: string;
  photoPaths: string[];
}): Promise<Incident> {
  const report = incidentReportSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("report_incident", {
    p_type: report.type,
    p_severity: report.severity,
    p_title: report.title,
    p_description: report.description || null,
    p_location: report.location || null,
    p_photos: report.photoPaths,
  });
  throwOnError(error);
  return requireData(data);
}

export async function uploadIncidentPhoto(file: File): Promise<string> {
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
        (result) => result
          ? resolve(result)
          : reject(new Error("image_processing_failed")),
        "image/jpeg",
        0.82,
      );
    });
    if (blob.size > 5 * 1024 * 1024) throw new Error("image_too_large");
    const folderId = crypto.randomUUID();
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "photo";
    const path = `incidents/${folderId}/${baseName}-${crypto.randomUUID()}.jpg`;
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

export async function listIncidents(
  filters: IncidentFilters,
  userId: string,
): Promise<Incident[]> {
  const client = getSupabaseClient();
  let query = client.from("incidents").select("*").order("created_at", { ascending: false }).limit(500);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.severity) query = query.eq("severity", filters.severity);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.assignedToMe) query = query.eq("assigned_to", userId);
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new Error("invalid_date_range");
  }
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) {
    const exclusiveEnd = new Date(`${filters.to}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    query = query.lt("created_at", exclusiveEnd.toISOString());
  }
  const term = filters.search.trim();
  if (term) {
    const pattern = `"%${escapeSearchTerm(term)}%"`;
    query = query.or(`title.ilike.${pattern},description.ilike.${pattern},location.ilike.${pattern}`);
  }
  const { data, error } = await query;
  throwOnError(error);
  return requireData(data);
}

export async function loadIncident(incidentId: string): Promise<{
  incident: Incident;
  events: IncidentTimelineEvent[];
  signedPhotos: string[];
}> {
  const client = getSupabaseClient();
  const { data: incident, error } = await client
    .from("incidents")
    .select("*")
    .eq("id", incidentId)
    .single();
  throwOnError(error);
  const record = requireData(incident);
  const [timelineResult, photoResult] = await Promise.all([
    client.rpc("get_incident_timeline", { p_id: incidentId }),
    record.photo_paths.length
      ? client.storage.from("attachments").createSignedUrls(record.photo_paths, 60)
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwOnError(timelineResult.error);
  throwOnError(photoResult.error);
  const signedPhotos = requireData(photoResult.data).map((photo) => {
    if (!photo.signedUrl) throw new Error("Could not sign an incident photo.");
    return photo.signedUrl;
  });
  return { incident: record, events: requireData(timelineResult.data), signedPhotos };
}

export async function loadIncidentStaff(): Promise<IncidentStaff[]> {
  const { data, error } = await getSupabaseClient().rpc("get_incident_staff");
  throwOnError(error);
  return requireData(data);
}

export async function assignIncident(incidentId: string, userId: string): Promise<void> {
  const assignment = assignmentSchema.parse({ incidentId, userId });
  const { error } = await getSupabaseClient().rpc("assign_incident", {
    p_id: assignment.incidentId,
    p_user: assignment.userId,
  });
  throwOnError(error);
}

export async function updateIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  note: string,
): Promise<void> {
  const input = statusSchema.parse({ incidentId, status, note });
  const { error } = await getSupabaseClient().rpc("update_incident_status", {
    p_id: input.incidentId,
    p_status: input.status,
    p_note: input.note || null,
  });
  throwOnError(error);
}

export async function addIncidentComment(incidentId: string, body: string): Promise<void> {
  const input = commentSchema.parse({ incidentId, body });
  const { error } = await getSupabaseClient().rpc("add_incident_comment", {
    p_id: input.incidentId,
    p_body: input.body,
  });
  throwOnError(error);
}
