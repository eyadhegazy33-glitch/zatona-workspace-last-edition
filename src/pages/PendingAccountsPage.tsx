import { Check, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  approveAccount,
  getAllRoles,
  getPendingAccounts,
  rejectAccount,
  type PendingAccount,
} from "../services/pendingAccounts";
import type { RegistrableRole } from "../services/roles";

type PendingAction = "approve" | "reject";

type DialogState = {
  action: PendingAction;
  account: PendingAccount;
};

export function PendingAccountsPage() {
  const { i18n, t } = useTranslation();
  const [accounts, setAccounts] = useState<PendingAccount[]>([]);
  const [roles, setRoles] = useState<RegistrableRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    try {
      const [pendingAccounts, allRoles] = await Promise.all([
        getPendingAccounts(),
        getAllRoles(),
      ]);
      setAccounts(pendingAccounts);
      setRoles(allRoles);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!dialog || dialog.action !== "approve") {
      return;
    }

    const initialRoleId =
      dialog.account.requested_role_id &&
      roles.some((role) => role.id === dialog.account.requested_role_id)
        ? dialog.account.requested_role_id
        : (roles[0]?.id ?? "");
    setSelectedRoleId(initialRoleId);
  }, [dialog, roles]);

  const openDialog = (action: PendingAction, account: PendingAccount) => {
    setToast(null);
    setReasonError(false);
    setRejectReason("");
    setDialog({ action, account });
  };

  const closeDialog = () => {
    if (!actionLoading) {
      setDialog(null);
      setReasonError(false);
    }
  };

  const handleConfirm = async () => {
    if (!dialog || actionLoading) {
      return;
    }

    if (dialog.action === "approve" && !selectedRoleId) {
      return;
    }

    if (dialog.action === "reject" && !rejectReason.trim()) {
      setReasonError(true);
      return;
    }

    setActionLoading(true);
    setToast(null);

    try {
      if (dialog.action === "approve") {
        await approveAccount(dialog.account.id, selectedRoleId);
      } else {
        await rejectAccount(dialog.account.id, rejectReason.trim());
      }

      setDialog(null);
      setToast({
        kind: "success",
        message:
          dialog.action === "approve"
            ? "pendingAccounts.toast.approved"
            : "pendingAccounts.toast.rejected",
      });
      await refresh();
    } catch {
      setToast({
        kind: "error",
        message: "pendingAccounts.toast.actionFailed",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage === "ar" ? "ar" : "en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">
            {t("pages.pendingAccounts.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t("pages.pendingAccounts.description")}
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? t("pendingAccounts.loading") : t("pendingAccounts.refresh")}
        </button>
      </div>

      {toast && (
        <p
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
          role={toast.kind === "success" ? "status" : "alert"}
        >
          {t(toast.message)}
        </p>
      )}

      {loadError && (
        <div
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          <span>{t("pendingAccounts.errors.load")}</span>
          <button
            className="font-medium underline underline-offset-2"
            onClick={() => void refresh()}
            type="button"
          >
            {t("pendingAccounts.refresh")}
          </button>
        </div>
      )}

      {loading ? (
        <div
          className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400"
          role="status"
        >
          <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
          {t("pendingAccounts.loading")}
        </div>
      ) : !loadError && accounts.length === 0 ? (
        <p className="mt-8 rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t("pendingAccounts.empty")}
        </p>
      ) : (
        !loadError && (
          <div className="mt-7 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[760px] border-collapse text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="px-4 py-3">{t("pendingAccounts.columns.name")}</th>
                  <th className="px-4 py-3">{t("pendingAccounts.columns.email")}</th>
                  <th className="px-4 py-3">{t("pendingAccounts.columns.role")}</th>
                  <th className="px-4 py-3">{t("pendingAccounts.columns.created")}</th>
                  <th className="px-4 py-3">{t("pendingAccounts.columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                    key={account.id}
                  >
                    <td className="px-4 py-4 font-medium text-ink dark:text-slate-100">
                      {[account.first_name, account.last_name]
                        .filter(Boolean)
                        .join(" ") || t("pendingAccounts.unknownName")}
                    </td>
                    <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                      {account.email}
                    </td>
                    <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                      {account.requested_role?.name ??
                        t("pendingAccounts.noRequestedRole")}
                    </td>
                    <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                      {formatDate(account.created_at)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                          onClick={() => openDialog("approve", account)}
                          type="button"
                        >
                          <Check aria-hidden="true" size={14} />
                          {t("pendingAccounts.approve")}
                        </button>
                        <button
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                          onClick={() => openDialog("reject", account)}
                          type="button"
                        >
                          <X aria-hidden="true" size={14} />
                          {t("pendingAccounts.reject")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDialog();
            }
          }}
        >
          <section
            aria-labelledby="pending-action-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
          >
            <h2
              className="text-xl font-semibold text-ink dark:text-white"
              id="pending-action-title"
            >
              {t(
                dialog.action === "approve"
                  ? "pendingAccounts.dialog.approveTitle"
                  : "pendingAccounts.dialog.rejectTitle",
              )}
            </h2>
            <p className="mt-2 break-all text-sm text-slate-600 dark:text-slate-400">
              {dialog.account.email}
            </p>

            {dialog.action === "approve" ? (
              <div className="mt-5">
                <label
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                  htmlFor="approval-role"
                >
                  {t("pendingAccounts.dialog.roleLabel")}
                </label>
                <select
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  id="approval-role"
                  onChange={(event) => setSelectedRoleId(event.target.value)}
                  value={selectedRoleId}
                >
                  <option disabled value="">
                    {t("pendingAccounts.dialog.selectRole")}
                  </option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-5">
                <label
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                  htmlFor="rejection-reason"
                >
                  {t("pendingAccounts.dialog.reasonLabel")}
                </label>
                <textarea
                  className="mt-2 min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  id="rejection-reason"
                  onChange={(event) => {
                    setRejectReason(event.target.value);
                    if (event.target.value.trim()) {
                      setReasonError(false);
                    }
                  }}
                  value={rejectReason}
                />
                {reasonError && (
                  <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {t("pendingAccounts.dialog.reasonRequired")}
                  </p>
                )}
              </div>
            )}

            <div className="mt-7 flex justify-end gap-3">
              <button
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                disabled={actionLoading}
                onClick={closeDialog}
                type="button"
              >
                {t("pendingAccounts.dialog.cancel")}
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  actionLoading ||
                  (dialog.action === "approve" && !selectedRoleId)
                }
                onClick={() => void handleConfirm()}
                type="button"
              >
                {actionLoading && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={16}
                  />
                )}
                {actionLoading
                  ? t("pendingAccounts.dialog.working")
                  : t("pendingAccounts.dialog.confirm")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
