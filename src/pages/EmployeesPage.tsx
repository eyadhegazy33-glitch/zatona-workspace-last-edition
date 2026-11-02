import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Mail,
  Pencil,
  Search,
  Shield,
  Trash2,
  UserRoundCheck,
  UserRoundX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "../hooks/useAuth";
import {
  getEmployees,
  sendEmployeePasswordReset,
  setEmployeeStatus,
  softDeleteEmployee,
  updateEmployee,
  type Employee,
} from "../services/employees";
import { getAllRoles, type RegistrableRole } from "../services/roles";

type EmployeeAction = "edit" | "suspend" | "reactivate" | "delete" | "reset";
type EmployeeDialog = { action: EmployeeAction; employee: Employee } | null;
type Toast = { kind: "success" | "error"; key: string } | null;

const employeeSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(2, "employees.validation.firstNameMin")
    .max(50, "employees.validation.firstNameMax"),
  lastName: z
    .string()
    .trim()
    .min(2, "employees.validation.lastNameMin")
    .max(50, "employees.validation.lastNameMax"),
  roleId: z.string().min(1, "employees.validation.role"),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;
const pageSize = 10;

const inputClassName =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

export function EmployeesPage() {
  const { i18n, t } = useTranslation();
  const { permissions, profile } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<RegistrableRole[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<EmployeeDialog>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset: resetForm,
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { firstName: "", lastName: "", roleId: "" },
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setQuerySearch(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    let mounted = true;
    void getAllRoles()
      .then((allRoles) => {
        if (mounted) {
          setRoles(allRoles);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadError(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const canManage = permissions.includes("employees.manage");
  const canManageRoles = permissions.includes("roles.manage");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await getEmployees({
        search: querySearch,
        roleId: roleFilter,
        status: statusFilter,
        page,
        pageSize,
      });
      setEmployees(result.employees);
      setTotal(result.total);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [page, querySearch, roleFilter, statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openDialog = (action: EmployeeAction, employee: Employee) => {
    setToast(null);
    setActionError(null);
    setDialog({ action, employee });
    if (action === "edit") {
      resetForm({
        firstName: employee.first_name,
        lastName: employee.last_name,
        roleId: employee.role_id,
      });
    }
  };

  const closeDialog = () => {
    if (!actionLoading && !isSubmitting) {
      setDialog(null);
      setActionError(null);
    }
  };

  const runAction = async (values?: EmployeeFormValues) => {
    if (!dialog || actionLoading) {
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setToast(null);
    try {
      if (dialog.action === "edit" && values) {
        await updateEmployee({
          userId: dialog.employee.id,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          roleId: values.roleId,
        });
      } else if (dialog.action === "suspend") {
        await setEmployeeStatus(dialog.employee.id, "suspended");
      } else if (dialog.action === "reactivate") {
        await setEmployeeStatus(dialog.employee.id, "active");
      } else if (dialog.action === "delete") {
        await softDeleteEmployee(dialog.employee.id);
      } else if (dialog.action === "reset") {
        await sendEmployeePasswordReset(dialog.employee.email);
      }

      const successKeys: Record<EmployeeAction, string> = {
        edit: "employees.toast.updated",
        suspend: "employees.toast.suspended",
        reactivate: "employees.toast.reactivated",
        delete: "employees.toast.deleted",
        reset: "employees.toast.resetSent",
      };
      setDialog(null);
      setToast({ kind: "success", key: successKeys[dialog.action] });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("cannot suspend yourself")) {
        setActionError("employees.errors.cannotSuspendSelf");
      } else if (message.includes("cannot delete yourself")) {
        setActionError("employees.errors.cannotDeleteSelf");
      } else if (message.includes("last active admin")) {
        setActionError("employees.errors.lastAdmin");
      } else if (message.includes("not allowed") || message.includes("permission")) {
        setActionError("employees.errors.permission");
      } else {
        setActionError("employees.errors.action");
      }
    } finally {
      setActionLoading(false);

    }
  };

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar" : "en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(date));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canEditEmployee = (employee: Employee) =>
    canManage && (employee.role?.name !== "Admin" || canManageRoles);
  const dialogTitle = dialog
    ? t(`employees.dialog.${dialog.action}Title`)
    : "";
  const isRtl = i18n.dir() === "rtl";

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">
            {t("pages.employees.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t("pages.employees.description")}
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? t("employees.loading") : t("employees.refresh")}
        </button>
      </div>

      {toast && (
        <p
          className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {t(toast.key)}
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_15rem_13rem]">
        <label className="relative block">
          <span className="sr-only">{t("employees.search")}</span>
          <Search
            aria-hidden="true"
            className="absolute top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
            style={{ [isRtl ? "right" : "left"]: "0.85rem" }}
          />
          <input
            className={`${inputClassName} mt-0 py-2.5`}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("employees.search")}
            type="search"
            value={search}
            style={{ [isRtl ? "paddingRight" : "paddingLeft"]: "2.5rem" }}
          />
        </label>
        <label>
          <span className="sr-only">{t("employees.filterRole")}</span>
          <select
            className={`${inputClassName} mt-0`}
            onChange={(event) => {
              setRoleFilter(event.target.value);
              setPage(0);
            }}
            value={roleFilter}
          >
            <option value="">{t("employees.allRoles")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t("employees.filterStatus")}</span>
          <select
            className={`${inputClassName} mt-0`}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(0);
            }}
            value={statusFilter}
          >
            <option value="">{t("employees.allStatuses")}</option>
            <option value="active">{t("employees.status.active")}</option>
            <option value="suspended">{t("employees.status.suspended")}</option>
          </select>
        </label>
      </div>

      {loadError && (
        <p
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t("employees.errors.load")}
        </p>
      )}

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-start text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold sm:px-5">
                  {t("employees.columns.name")}
                </th>
                <th className="px-4 py-3 font-semibold sm:px-5">
                  {t("employees.columns.email")}
                </th>
                <th className="px-4 py-3 font-semibold sm:px-5">
                  {t("employees.columns.role")}
                </th>
                <th className="px-4 py-3 font-semibold sm:px-5">
                  {t("employees.columns.status")}
                </th>
                <th className="px-4 py-3 font-semibold sm:px-5">
                  {t("employees.columns.updated")}
                </th>
                {canManage && (
                  <th className="px-4 py-3 font-semibold sm:px-5">
                    {t("employees.columns.actions")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td
                    className="px-5 py-12 text-center text-slate-500 dark:text-slate-400"
                    colSpan={canManage ? 6 : 5}
                  >
                    <LoaderCircle
                      aria-hidden="true"
                      className="mx-auto mb-2 animate-spin"
                      size={20}
                    />
                    {t("employees.loading")}
                  </td>
                </tr>
              )}
              {!loading && employees.length === 0 && !loadError && (
                <tr>
                  <td
                    className="px-5 py-12 text-center text-slate-500 dark:text-slate-400"
                    colSpan={canManage ? 6 : 5}
                  >
                    {t("employees.empty")}
                  </td>
                </tr>
              )}
              {!loading &&
                employees.map((employee) => {
                  const canManageEmployee = canEditEmployee(employee);
                  return (
                    <tr
                      className="text-slate-700 dark:text-slate-200"
                      key={employee.id}
                    >
                      <td className="whitespace-nowrap px-4 py-4 font-medium text-ink dark:text-white sm:px-5">
                        {[employee.first_name, employee.last_name]
                          .filter(Boolean)
                          .join(" ")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 sm:px-5">
                        {employee.email}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 sm:px-5">
                        {employee.role?.name ?? t("employees.noRole")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 sm:px-5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            employee.status === "active"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : employee.status === "suspended"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {t(`employees.status.${employee.status}`)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-500 dark:text-slate-400 sm:px-5">
                        {formatDate(employee.updated_at)}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 sm:px-5">
                          {canManageEmployee ? (
                            <div className="flex items-center gap-1">
                              <ActionButton
                                label={t("employees.actions.edit")}
                                onClick={() => openDialog("edit", employee)}
                              >
                                <Pencil size={16} />
                              </ActionButton>
                              {employee.id !== profile?.id && (
                                <ActionButton
                                  label={t(
                                    employee.status === "suspended"
                                      ? "employees.actions.reactivate"
                                      : "employees.actions.suspend",
                                  )}
                                  onClick={() =>
                                    openDialog(
                                      employee.status === "suspended"
                                        ? "reactivate"
                                        : "suspend",
                                      employee,
                                    )
                                  }
                                >
                                  {employee.status === "suspended" ? (
                                    <UserRoundCheck size={17} />
                                  ) : (
                                    <UserRoundX size={17} />
                                  )}
                                </ActionButton>
                              )}
                              <ActionButton
                                label={t("employees.actions.reset")}
                                onClick={() => openDialog("reset", employee)}
                              >
                                <Mail size={16} />
                              </ActionButton>
                              {employee.id !== profile?.id && (
                                <ActionButton
                                  label={t("employees.actions.delete")}
                                  onClick={() => openDialog("delete", employee)}
                                >
                                  <Trash2 size={16} />
                                </ActionButton>
                              )}
                            </div>
                          ) : (
                            <span
                              aria-label={t("employees.adminProtected")}
                              className="inline-flex text-slate-400"
                              title={t("employees.adminProtected")}
                            >
                              <Shield aria-hidden="true" size={17} />
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("employees.pagination.summary", {
              start: total === 0 ? 0 : page * pageSize + 1,
              end: Math.min((page + 1) * pageSize, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              aria-label={t("employees.pagination.previous")}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={page === 0 || loading}
              onClick={() => setPage((current) => Math.max(current - 1, 0))}
              type="button"
            >
              {isRtl ? (
                <ChevronRight aria-hidden="true" size={17} />
              ) : (
                <ChevronLeft aria-hidden="true" size={17} />
              )}
            </button>
            <span className="min-w-16 text-center text-sm text-slate-600 dark:text-slate-300">
              {t("employees.pagination.page", {
                current: Math.min(page + 1, totalPages),
                total: totalPages,
              })}
            </span>
            <button
              aria-label={t("employees.pagination.next")}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={(page + 1) * pageSize >= total || loading}
              onClick={() =>
                setPage((current) =>
                  Math.min(current + 1, Math.max(totalPages - 1, 0)),
                )
              }
              type="button"
            >
              {isRtl ? (
                <ChevronLeft aria-hidden="true" size={17} />
              ) : (
                <ChevronRight aria-hidden="true" size={17} />
              )}
            </button>
          </div>
        </div>
      </div>

      {dialog && (
        <div
          aria-labelledby="employee-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4"
          role="dialog"
        >
          <div className="my-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-xl font-semibold text-ink dark:text-white"
                  id="employee-dialog-title"
                >
                  {dialogTitle}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {dialog.employee.first_name} {dialog.employee.last_name}
                </p>
              </div>
              <button
                aria-label={t("employees.dialog.close")}
                className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                disabled={actionLoading || isSubmitting}
                onClick={closeDialog}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {dialog.action === "edit" ? (
              <form
                className="mt-5 space-y-4"
                noValidate
                onSubmit={(event) => {
                  void handleSubmit((values) => runAction(values))(event);
                }}
              >
                <div>
                  <label
                    className="text-sm font-medium text-slate-700 dark:text-slate-300"
                    htmlFor="employee-first-name"
                  >
                    {t("employees.fields.firstName")}
                  </label>
                  <input
                    autoFocus
                    className={inputClassName}
                    id="employee-first-name"
                    maxLength={50}
                    {...register("firstName")}
                  />
                  {errors.firstName && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {t(errors.firstName.message ?? "auth.errors.generic")}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    className="text-sm font-medium text-slate-700 dark:text-slate-300"
                    htmlFor="employee-last-name"
                  >
                    {t("employees.fields.lastName")}
                  </label>
                  <input
                    className={inputClassName}
                    id="employee-last-name"
                    maxLength={50}
                    {...register("lastName")}
                  />
                  {errors.lastName && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {t(errors.lastName.message ?? "auth.errors.generic")}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    className="text-sm font-medium text-slate-700 dark:text-slate-300"
                    htmlFor="employee-role"
                  >
                    {t("employees.fields.role")}
                  </label>
                  <select
                    className={inputClassName}
                    id="employee-role"
                    {...register("roleId")}
                  >
                    <option value="">{t("employees.allRoles")}</option>
                    {roles
                      .filter(
                        (role) =>
                          role.name !== "Admin" ||
                          canManageRoles,
                      )
                      .map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                  </select>
                  {errors.roleId && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {t(errors.roleId.message ?? "auth.errors.generic")}
                    </p>
                  )}
                </div>
                {actionError && (
                  <ActionError message={t(actionError)} />
                )}
                <DialogButtons
                  busy={actionLoading || isSubmitting}
                  cancelLabel={t("employees.dialog.cancel")}
                  confirmLabel={t("employees.dialog.save")}
                  busyLabel={t("employees.dialog.saving")}
                  onCancel={closeDialog}
                />
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t(`employees.dialog.${dialog.action}Message`, {
                    email: dialog.employee.email,
                  })}
                </p>
                {actionError && (
                  <ActionError message={t(actionError)} />
                )}
                <DialogButtons
                  busy={actionLoading}
                  cancelLabel={t("employees.dialog.cancel")}
                  confirmLabel={t(`employees.dialog.${dialog.action}Confirm`)}
                  busyLabel={t("employees.dialog.working")}
                  onCancel={closeDialog}
                  onConfirm={() => void runAction()}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ActionButton({
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
      className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <p
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      role="alert"
    >
      {message}
    </p>
  );
}

function DialogButtons({
  busy,
  cancelLabel,
  confirmLabel,
  busyLabel,
  disabled = false,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  cancelLabel: string;
  confirmLabel: string;
  busyLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <button
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        {cancelLabel}
      </button>
      <button
        className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy || disabled}
        onClick={onConfirm}
        type={onConfirm ? "button" : "submit"}
      >
        {busy && <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />}
        {busy ? busyLabel || t("employees.dialog.working") : confirmLabel}
      </button>
    </div>
  );
}
