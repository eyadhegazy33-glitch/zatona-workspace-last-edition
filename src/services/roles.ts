import { getSupabaseClient } from "../lib/supabase";

export type RegistrableRole = {
  id: string;
  name: string;
};

export type ManagedRole = RegistrableRole & {
  is_system: boolean;
  is_registrable: boolean;
  created_at: string;
};

export type Permission = {
  key: string;
  description: string | null;
};

export function isCustomerStaffRole(roleName: string | null | undefined): boolean {
  const normalizedName = roleName?.trim().toLowerCase();
  return normalizedName === "admin" || normalizedName === "reception";
}

export async function getRoles(): Promise<ManagedRole[]> {
  const { data, error } = await getSupabaseClient()
    .from("roles")
    .select("id, name, is_system, is_registrable, created_at")
    .order("name");

  if (error) {
    throw error;
  }

  return data;
}

export async function getPermissionCatalog(): Promise<Permission[]> {
  const { data, error } = await getSupabaseClient()
    .from("permissions")
    .select("key, description")
    .order("key");

  if (error) {
    throw error;
  }

  return data;
}

export async function createRole(
  name: string,
  isRegistrable: boolean,
): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("create_role", {
    p_name: name,
    p_is_registrable: isRegistrable,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function renameRole(roleId: string, name: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("rename_role", {
    p_role: roleId,
    p_name: name,
  });

  if (error) {
    throw error;
  }
}

export async function deleteRole(roleId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("delete_role", {
    p_role: roleId,
  });

  if (error) {
    throw error;
  }
}

export async function setRolePermissions(
  roleId: string,
  permissionKeys: string[],
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_role_permissions", {
    p_role: roleId,
    p_permissions: permissionKeys,
  });

  if (error) {
    throw error;
  }
}

export async function setRoleRegistrable(
  roleId: string,
  isRegistrable: boolean,
): Promise<void> {
  const { error } = await getSupabaseClient().rpc("set_role_registrable", {
    p_role: roleId,
    p_is_registrable: isRegistrable,
  });

  if (error) {
    throw error;
  }
}

export async function getRegistrableRoles(): Promise<RegistrableRole[]> {
  const { data, error } = await getSupabaseClient()
    .from("roles")
    .select("id, name")
    .eq("is_registrable", true)
    .order("name");

  if (error) {
    throw error;
  }

  return data;
}

export async function getAllRoles(): Promise<RegistrableRole[]> {
  const { data, error } = await getSupabaseClient()
    .from("roles")
    .select("id, name")
    .order("name");

  if (error) {
    throw error;
  }

  return data;
}

export async function getRolePermissionKeys(
  roleId: string,
): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from("role_permissions")
    .select("permission_key")
    .eq("role_id", roleId);

  if (error) {
    throw error;
  }

  return data.map(({ permission_key }) => permission_key);
}
