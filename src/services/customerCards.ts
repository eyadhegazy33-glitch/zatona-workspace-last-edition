import { getSupabaseClient } from "../lib/supabase";
import type { CustomerStatus, StudentType } from "./customers";

export type CustomerCardRecord = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  birth_date: string;
  student_type_id: string;
  status: CustomerStatus;
  created_at: string;
  import_id: string | null;
  student_type: StudentType | null;
};

export type CustomerImportOption = {
  id: string;
  created_at: string;
};

export type CustomerCardFilters = {
  search: string;
  studentTypeId: string;
  createdToday: boolean;
  importId: string;
  customerId?: string;
};

export type CustomerCardPage = {
  records: CustomerCardRecord[];
  total: number;
};

type CustomerCardRow = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  student_type_id: string;
  status: CustomerStatus;
  created_at: string;
  import_id: string | null;
  student_type?: {
    id: string;
    name_en: string;
    name_ar: string;
    is_active: boolean;
  } | null;
};

const maxPageSize = 500;

function escapeSearchTerm(value: string): string {
  return value.replace(/[\\%_,()."]/g, "\\$&");
}

function getErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function isStudentTypeEmbedError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "PGRST200" || code === "PGRST201" || code === "42703";
}

function addFilters(
  query: ReturnType<ReturnType<typeof getSupabaseClient>["from"]>,
  filters: CustomerCardFilters,
) {
  let filtered = query.is("deleted_at", null);

  if (filters.studentTypeId) {
    filtered = filtered.eq("student_type_id", filters.studentTypeId);
  }
  if (filters.importId) {
    filtered = filtered.eq("import_id", filters.importId);
  }
  if (filters.customerId) {
    filtered = filtered.eq("id", filters.customerId);
  }
  if (filters.createdToday) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    filtered = filtered
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
  }
  if (filters.search.trim()) {
    const term = escapeSearchTerm(filters.search.trim());
    filtered = filtered.or(
      `full_name.ilike.%${term}%,code.ilike.%${term}%,phone.ilike.%${term}%`,
    );
  }
  return filtered;
}

function normalizeRows(
  rows: CustomerCardRow[],
): CustomerCardRecord[] {
  return rows.map((row) => ({
    ...row,
    full_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    student_type: row.student_type
      ? {
          id: row.student_type.id,
          name_en: row.student_type.name_en,
          name_ar: row.student_type.name_ar,
          active: row.student_type.is_active,
        }
      : null,
  }));
}

async function loadStudentTypesForRows(
  rows: CustomerCardRow[],
): Promise<Map<string, StudentType>> {
  const missingIds = [
    ...new Set(
      rows
        .filter((row) => !row.student_type)
        .map((row) => row.student_type_id),
    ),
  ];
  if (!missingIds.length) return new Map();

  const { data, error } = await getSupabaseClient()
    .from("student_types")
    .select("id, name_en, name_ar, is_active")
    .in("id", missingIds);
  if (error) throw error;

  return new Map(
    data.map((studentType) => [
      studentType.id,
      {
        id: studentType.id,
        name_en: studentType.name_en,
        name_ar: studentType.name_ar,
        active: studentType.is_active,
      },
    ]),
  );
}

export async function getCustomerCardRecords(
  filters: CustomerCardFilters,
  options: { offset?: number; limit?: number } = {},
): Promise<CustomerCardPage> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(maxPageSize, Math.max(1, options.limit ?? 50));
  const columns =
    "id, code, first_name, last_name, birth_date, student_type_id, status, created_at, import_id";
  const client = getSupabaseClient();
  const baseQuery = () =>
    addFilters(
      client.from("customers").select(columns, { count: "exact" }),
      filters,
    )
      .order("last_name")
      .order("first_name")
      .order("id")
      .range(offset, offset + limit - 1);

  let result = await addFilters(
    client
      .from("customers")
      .select(
        `${columns}, student_type:student_types(id, name_en, name_ar, is_active)`,
        { count: "exact" },
      ),
    filters,
  )
    .order("last_name")
    .order("first_name")
    .order("id")
    .range(offset, offset + limit - 1);

  if (result.error && isStudentTypeEmbedError(result.error)) {
    result = await baseQuery();
  }
  if (result.error) throw result.error;

  const rows: CustomerCardRow[] = result.data ?? [];
  const missingStudentTypes = await loadStudentTypesForRows(rows);
  const normalized = normalizeRows(
    rows.map((row) => ({
      ...row,
      student_type:
        row.student_type ??
        (() => {
          const studentType = missingStudentTypes.get(row.student_type_id);
          return studentType
            ? {
                id: studentType.id,
                name_en: studentType.name_en,
                name_ar: studentType.name_ar,
                is_active: studentType.active,
              }
            : null;
        })(),
    })),
  );

  return { records: normalized, total: result.count ?? 0 };
}

export async function getCustomerImportOptions(): Promise<CustomerImportOption[]> {
  const { data, error } = await getSupabaseClient()
    .from("imports")
    .select("id, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function logCustomerCardPrint(count: number): Promise<void> {
  const { error } = await getSupabaseClient().rpc("log_card_print", {
    p_count: count,
  });

  if (error) throw error;
}
