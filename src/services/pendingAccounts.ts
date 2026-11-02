import { getSupabaseClient } from "../lib/supabase";
import { getAllRoles } from "./roles";

export type PendingAccount = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  requested_role_id: string | null;
  created_at: string;
  requested_role: { name: string } | null;
};

export { getAllRoles };

export async function getPendingAccounts(): Promise<PendingAccount[]> {
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select(
      "id, first_name, last_name, email, requested_role_id, created_at, requested_role:roles!profiles_requested_role_id_fkey(name)",
    )
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data as unknown as Array<
    Omit<PendingAccount, "requested_role"> & {
      requested_role:
        | { name: string }
        | { name: string }[]
        | null;
    }
  >).map((account) => ({
    ...account,
    requested_role: Array.isArray(account.requested_role)
      ? (account.requested_role[0] ?? null)
      : account.requested_role,
  }));
}

export async function approveAccount(
  userId: string,
  roleId: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("approve_account", {
    p_user: userId,
    p_role: roleId,
  });

  if (error) {
    throw error;
  }
}

export async function rejectAccount(
  userId: string,
  reason: string,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("reject_account", {
    p_user: userId,
    p_reason: reason,
  });

  if (error) {
    throw error;
  }
}
