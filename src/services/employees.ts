import { getSupabaseClient } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import type { RegistrableRole } from "./roles";

export type EmployeeStatus = Database["public"]["Enums"]["account_status"];

export type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role_id: string;
  status: EmployeeStatus;
  created_at: string;
  updated_at: string;
  role: { name: string } | null;
};

export type EmployeePage = {
  employees: Employee[];
  total: number;
};

type EmployeeRow = Omit<Employee, "role"> & {
  role: { name: string } | { name: string }[] | null;
};

function escapeSearchTerm(value: string): string {
  return value.replace(/[\\%_,()."]/g, "\\$&");
}

export async function getEmployees(input: {
  search: string;
  roleId: string;
  status: string;
  page: number;
  pageSize: number;
}): Promise<EmployeePage> {
  const from = input.page * input.pageSize;
  let query = getSupabaseClient()
    .from("profiles")
    .select(
      "id, first_name, last_name, email, role_id, status, created_at, updated_at, role:roles!profiles_role_id_fkey(name)",
      { count: "exact" },
    )
    .not("role_id", "is", null)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .range(from, from + input.pageSize - 1);

  if (input.roleId) {
    query = query.eq("role_id", input.roleId);
  }
  if (input.status) {
    query = query.eq("status", input.status as EmployeeStatus);
  }
  if (input.search.trim()) {
    const term = `"%${escapeSearchTerm(input.search.trim())}%"`;
    query = query.or(
      `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    throw error;
  }

  return {
    employees: (data as unknown as EmployeeRow[]).map((employee) => ({
      ...employee,
      role: Array.isArray(employee.role)
        ? (employee.role[0] ?? null)
        : employee.role,
    })),
    total: count ?? 0,
  };
}

export async function updateEmployee(input: {
  userId: string;
  firstName: string;
  lastName: string;
  roleId: string;
}): Promise<void> {
  const { error } = await getSupabaseClient().rpc("update_employee", {
    p_user: input.userId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_role: input.roleId,
  });
  if (error) {
    throw error;
  }
}

export async function setEmployeeStatus(
  userId: string,
  status: "active" | "suspended",
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_employee_status", {
    p_user: userId,
    p_status: status,
  });
  if (error) {
    throw error;
  }
}

export async function softDeleteEmployee(userId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("soft_delete_employee", {
    p_user: userId,
  });
  if (error) {
    throw error;
  }
}

export async function sendEmployeePasswordReset(
  email: string,
): Promise<void> {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) {
    throw error;
  }
}

export type { RegistrableRole };
