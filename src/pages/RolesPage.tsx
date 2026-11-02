import {
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  createRole,
  deleteRole,
  getRoles,
  getPermissionCatalog,
  getRolePermissionKeys,
  renameRole,
  setRolePermissions,
  setRoleRegistrable,
  type ManagedRole,
  type Permission,
} from "../services/roles";

type DialogState =
  | { mode: "create" }
  | { mode: "rename"; role: ManagedRole }
  | { mode: "delete"; role: ManagedRole }
  | null;

type ToastState = { type: "success" | "error"; key: string } | null;

const groups = [
  "accounts",
  "customers",
  "employees",
  "resources",
  "checkins",
  "scanner",
  "roles",
  "audit",
  "settings",
  "dashboard",
] as const;

const inputClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

export function RolesPage() {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<string[]>(
    [],
  );
  const [draftPermissionKeys, setDraftPermissionKeys] = useState<string[]>([]);
  const [roleName, setRoleName] = useState("");
  const [registrable, setRegistrable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRole =
    roles.find((role) => role.id === selectedRoleId) ?? null;
  const dirtyPermissions = useMemo(
    () =>
      [...draftPermissionKeys].sort().join("\0") !==
      [...selectedPermissionKeys].sort().join("\0"),
    [draftPermissionKeys, selectedPermissionKeys],
  );
  const groupedPermissions = useMemo(
    () =>
      groups.map((group) => ({
        group,
        permissions: permissions.filter(
          (permission) => permission.key.split(".", 1)[0] === group,
        ),
      })),
    [permissions],
  );

  const refreshRoles = useCallback(async (preferredRoleId?: string) => {
    const [nextRoles, nextPermissions] = await Promise.all([
      getRoles(),
      getPermissionCatalog(),
    ]);
    setRoles(nextRoles);
    setPermissions(nextPermissions);
    const nextSelected =
      nextRoles.find((role) => role.id === preferredRoleId) ??
      nextRoles.find((role) => role.id === selectedRoleId) ??
      nextRoles[0] ??
      null;
    setSelectedRoleId(nextSelected?.id ?? null);
    setRegistrable(nextSelected?.is_registrable ?? true);
    if (nextSelected) {
      const keys = await getRolePermissionKeys(nextSelected.id);
      setSelectedPermissionKeys(keys);
      setDraftPermissionKeys(keys);
    } else {
      setSelectedPermissionKeys([]);
      setDraftPermissionKeys([]);
    }
  }, [selectedRoleId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void Promise.all([getRoles(), getPermissionCatalog()])
      .then(async ([nextRoles, nextPermissions]) => {
        if (!mounted) return;
        setRoles(nextRoles);
        setPermissions(nextPermissions);
        const firstRole = nextRoles[0] ?? null;
        setSelectedRoleId(firstRole?.id ?? null);
        setRegistrable(firstRole?.is_registrable ?? true);
        const keys = firstRole
          ? await getRolePermissionKeys(firstRole.id)
          : [];
        if (mounted) {
          setSelectedPermissionKeys(keys);
          setDraftPermissionKeys(keys);
        }
      })
      .catch(() => {
        if (mounted) setError("roles.errors.load");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectRole = async (role: ManagedRole) => {
    setSelectedRoleId(role.id);
    setRegistrable(role.is_registrable);
    setError(null);
    setToast(null);
    setSaving(true);
    try {
      const keys = await getRolePermissionKeys(role.id);
      setSelectedPermissionKeys(keys);
      setDraftPermissionKeys(keys);
    } catch {
      setError("roles.errors.loadPermissions");
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (permissionKey: string) => {
    setDraftPermissionKeys((current) =>
      current.includes(permissionKey)
        ? current.filter((key) => key !== permissionKey)
        : [...current, permissionKey],
    );
  };

  const savePermissions = async () => {
    if (!selectedRole || saving) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      await setRolePermissions(selectedRole.id, draftPermissionKeys);
      setSelectedPermissionKeys(draftPermissionKeys);
      setToast({ type: "success", key: "roles.toast.permissionsSaved" });
    } catch (cause) {
      setError(mapRoleError(cause));
    } finally {
      setSaving(false);
    }
  };

  const updateRegistrable = async (value: boolean) => {
    if (!selectedRole || saving) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      await setRoleRegistrable(selectedRole.id, value);
      setRegistrable(value);
      setRoles((current) =>
        current.map((role) =>
          role.id === selectedRole.id
            ? { ...role, is_registrable: value }
            : role,
        ),
      );
      setToast({ type: "success", key: "roles.toast.registrableSaved" });
    } catch (cause) {
      setError(mapRoleError(cause));
    } finally {
      setSaving(false);
    }
  };

  const submitDialog = async () => {
    if (!dialog || saving) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      if (dialog.mode === "create") {
        const id = await createRole(roleName.trim(), registrable);
        await refreshRoles(id);
        setToast({ type: "success", key: "roles.toast.created" });
      } else if (dialog.mode === "rename") {
        await renameRole(dialog.role.id, roleName.trim());
        await refreshRoles(dialog.role.id);
        setToast({ type: "success", key: "roles.toast.renamed" });
      } else {
        await deleteRole(dialog.role.id);
        await refreshRoles();
        setToast({ type: "success", key: "roles.toast.deleted" });
      }
      setDialog(null);
      setRoleName("");
    } catch (cause) {
      setError(mapRoleError(cause));
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setRoleName("");
    setRegistrable(true);
    setError(null);
    setDialog({ mode: "create" });
  };

  const openRename = (role: ManagedRole) => {
    setRoleName(role.name);
    setError(null);
    setDialog({ mode: "rename", role });
  };

  const openDelete = (role: ManagedRole) => {
    setError(null);
    setDialog({ mode: "delete", role });
  };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">
            {t("pages.roles.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t("pages.roles.description")}
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90"
          onClick={openCreate}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          {t("roles.actions.create")}
        </button>
      </div>

      {toast && (
        <p
          className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
            toast.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
          role="status"
        >
          {t(toast.key)}
        </p>
      )}
      {error && <InlineError message={t(error)} />}

      {loading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-slate-500">
          <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
          {t("roles.loading")}
        </div>
      ) : (
        <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t("roles.roleList")}
            </h2>
            <div className="space-y-1">
              {roles.map((role) => (
                <div
                  className={`flex items-center gap-1 rounded-xl ${
                    selectedRoleId === role.id
                      ? "bg-brand/10 text-brand dark:bg-brand/20"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                  key={role.id}
                >
                  <button
                    aria-current={selectedRoleId === role.id ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-start text-sm font-medium"
                    disabled={saving}
                    onClick={() => void selectRole(role)}
                    type="button"
                  >
                    {role.is_system ? (
                      <Shield aria-hidden="true" className="shrink-0" size={16} />
                    ) : null}
                    <span className="truncate">{role.name}</span>
                    {role.is_registrable && (
                      <span className="ms-auto shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        {t("roles.registrableBadge")}
                      </span>
                    )}
                  </button>
                  {!role.is_system && (
                    <div className="flex items-center">
                      <IconButton
                        label={t("roles.actions.rename")}
                        onClick={() => openRename(role)}
                      >
                        <Pencil aria-hidden="true" size={15} />
                      </IconButton>
                      <IconButton
                        label={t("roles.actions.delete")}
                        onClick={() => openDelete(role)}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </IconButton>
                    </div>
                  )}
                </div>
              ))}
              {roles.length === 0 && (
                <p className="px-3 py-5 text-sm text-slate-500">
                  {t("roles.empty")}
                </p>
              )}
            </div>
          </aside>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            {selectedRole ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
                  <div>
                    <h2 className="text-xl font-semibold text-ink dark:text-white">
                      {selectedRole.name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {t("roles.permissionDescription")}
                    </p>
                  </div>
                  {selectedRole.is_system && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      <Shield aria-hidden="true" size={14} />
                      {t("roles.systemRole")}
                    </span>
                  )}
                </div>

                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <input
                    checked={registrable}
                    className="mt-1 size-4 accent-brand"
                    disabled={saving || selectedRole.is_system}
                    onChange={(event) =>
                      void updateRegistrable(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink dark:text-white">
                      {t("roles.showInRegister")}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                      {t("roles.registerHelp")}
                    </span>
                  </span>
                </label>

                <div className="mt-6 space-y-6">
                  {groupedPermissions.map(({ group, permissions: items }) =>
                    items.length > 0 ? (
                      <fieldset key={group}>
                        <legend className="mb-3 text-sm font-semibold text-ink dark:text-white">
                          {t(`roles.groups.${group}`)}
                        </legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {items.map((permission) => (
                            <label
                              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                              key={permission.key}
                            >
                              <input
                                checked={draftPermissionKeys.includes(
                                  permission.key,
                                )}
                                className="mt-0.5 size-4 accent-brand"
                                disabled={saving}
                                onChange={() =>
                                  togglePermission(permission.key)
                                }
                                type="checkbox"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-ink dark:text-white">
                                  {t(
                                    `roles.permissionNames.${permission.key}`,
                                    { defaultValue: permission.key },
                                  )}
                                </span>
                                {(t(
                                  `roles.permissionDescriptions.${permission.key}`,
                                  {
                                    defaultValue:
                                      permission.description ?? undefined,
                                  },
                                ) as string) && (
                                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {t(
                                      `roles.permissionDescriptions.${permission.key}`,
                                      {
                                        defaultValue:
                                          permission.description ?? "",
                                      },
                                    )}
                                  </span>
                                )}
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ) : null,
                  )}
                </div>

                <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                  <button
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    disabled={!dirtyPermissions || saving}
                    onClick={() => setDraftPermissionKeys(selectedPermissionKeys)}
                    type="button"
                  >
                    {t("roles.actions.discard")}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!dirtyPermissions || saving}
                    onClick={() => void savePermissions()}
                    type="button"
                  >
                    {saving ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                        size={16}
                      />
                    ) : (
                      <Check aria-hidden="true" size={16} />
                    )}
                    {saving
                      ? t("roles.actions.saving")
                      : t("roles.actions.savePermissions")}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center text-center">
                <Shield
                  aria-hidden="true"
                  className="text-slate-300 dark:text-slate-600"
                  size={36}
                />
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  {t("roles.selectRole")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onClick={() => !saving && setDialog(null)}
        >
          <section
            aria-labelledby="role-dialog-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                className="text-lg font-semibold text-ink dark:text-white"
                id="role-dialog-title"
              >
                {t(`roles.dialog.${dialog.mode}Title`)}
              </h2>
              <button
                aria-label={t("roles.dialog.close")}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={saving}
                onClick={() => setDialog(null)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {dialog.mode === "delete" ? (
              <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t("roles.dialog.deleteMessage", { name: dialog.role.name })}
              </p>
            ) : (
              <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                {t("roles.fields.name")}
                <input
                  autoFocus
                  className={`${inputClassName} mt-1.5`}
                  maxLength={50}
                  minLength={2}
                  onChange={(event) => setRoleName(event.target.value)}
                  required
                  value={roleName}
                />
              </label>
            )}
            {dialog.mode === "create" && (
              <label className="mt-4 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  checked={registrable}
                  className="size-4 accent-brand"
                  onChange={(event) => setRegistrable(event.target.checked)}
                  type="checkbox"
                />
                {t("roles.showInRegister")}
              </label>
            )}
            {error && <InlineError message={t(error)} />}
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                disabled={saving}
                onClick={() => setDialog(null)}
                type="button"
              >
                {t("roles.dialog.cancel")}
              </button>
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                  dialog.mode === "delete"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-brand hover:bg-brand/90"
                }`}
                disabled={
                  saving ||
                  (dialog.mode !== "delete" && roleName.trim().length < 2)
                }
                onClick={() => void submitDialog()}
                type="button"
              >
                {saving
                  ? t("roles.actions.saving")
                  : t(`roles.dialog.${dialog.mode}Confirm`)}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function mapRoleError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("role still has users")) return "roles.errors.hasUsers";
  if (message.includes("system role")) return "roles.errors.systemRole";
  if (message.includes("roles.manage may only be assigned by admin")) {
    return "roles.errors.adminOnlyPermission";
  }
  if (message.includes("already exists") || message.includes("duplicate key")) {
    return "roles.errors.duplicate";
  }
  if (message.includes("roles.manage") || message.includes("not allowed")) {
    return "roles.errors.permission";
  }
  if (message.includes("invalid role name")) return "roles.errors.invalidName";
  return "roles.errors.action";
}

function InlineError({ message }: { message: string }) {
  return (
    <p
      className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      role="alert"
    >
      {message}
    </p>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-lg p-2 text-slate-500 hover:bg-white/80 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
