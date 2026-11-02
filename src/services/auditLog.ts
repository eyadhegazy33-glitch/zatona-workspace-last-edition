import { z } from "zod";
import { getSupabaseClient } from "../lib/supabase";

const auditRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  created_at: z.string(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_role: z.string().nullable(),
  action: z.string(),
  entity: z.string().nullable(),
  entity_id: z.string().nullable(),
  old_value: z.unknown().nullable(),
  new_value: z.unknown().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
});

export type AuditLogRow = z.infer<typeof auditRowSchema>;

const auditUserSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  role_name: z.string().nullable(),
});

export type AuditUser = z.infer<typeof auditUserSchema>;

const scanRowSchema = z.object({
  id: z.union([z.number(), z.string()]),
  created_at: z.string(),
  result: z.enum(["ok", "blocked", "expired", "unknown"]),
  user_id: z.string().nullable(),
  employee_name: z.string().nullable(),
  customer_known: z.boolean(),
  customer_name: z.string().nullable(),
});

export type AuditScanRow = z.infer<typeof scanRowSchema>;

const pageSchema = <T extends z.ZodType>(rowSchema: T) =>
  z.object({ total_count: z.number(), rows: z.array(rowSchema) });

export type AuditFilters = {
  userId: string | null;
  action: string | null;
  entity: string | null;
  from: string | null;
  to: string | null;
  search: string | null;
};

function parsePage<T extends z.ZodType>(
  value: unknown,
  rowSchema: T,
): { total_count: number; rows: z.infer<T>[] } {
  return pageSchema(rowSchema).parse(value);
}

export async function listAuditLogs(
  filters: AuditFilters,
  limit: number,
  offset: number,
) {
  const { data, error } = await getSupabaseClient().rpc("list_audit_logs", {
    p_user: filters.userId,
    p_action: filters.action,
    p_entity: filters.entity,
    p_from: filters.from,
    p_to: filters.to,
    p_search: filters.search,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return parsePage(data, auditRowSchema);
}

export async function listAuditScans(
  result: string | null,
  limit: number,
  offset: number,
) {
  const { data, error } = await getSupabaseClient().rpc("list_audit_scans", {
    p_result: result,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return parsePage(data, scanRowSchema);
}

export async function getAuditActions(): Promise<string[]> {
  const { data, error } = await getSupabaseClient().rpc("audit_log_actions");
  if (error) throw error;
  return z.array(z.object({ action: z.string() })).parse(data).map(({ action }) => action);
}

export async function getAuditUsers(): Promise<AuditUser[]> {
  const { data, error } = await getSupabaseClient().rpc("audit_log_users");
  if (error) throw error;
  return z.array(auditUserSchema).parse(data);
}

export async function getSuspiciousAudit(days: number): Promise<AuditLogRow[]> {
  const { data, error } = await getSupabaseClient().rpc("audit_suspicious", {
    p_days: days,
  });
  if (error) throw error;
  return z.array(auditRowSchema).parse(data);
}
