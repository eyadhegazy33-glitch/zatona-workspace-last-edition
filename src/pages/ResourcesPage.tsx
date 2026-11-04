import { zodResolver } from "@hookform/resolvers/zod";
import {
  Armchair,
  Building2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { SearchFilterBar } from "../components/SearchFilterBar";
import { useAuth } from "../hooks/useAuth";
import { useResources } from "../hooks/useResources";
import {
  assignCustomerToResource,
  bulkCreateResources,
  checkInCustomerToResource,
  createResource,
  deleteResource,
  searchResourceCustomers,
  updateResource,
  type Resource,
  type ResourceCustomerCandidate,
  type ResourceStatus,
  type ResourceType,
} from "../services/resources";

type Toast = {
  kind: "success" | "error";
  key: string;
  params?: Record<string, number>;
} | null;

const resourceSchema = z.object({
  type: z.enum(["seat", "room", "table"]),
  name: z
    .string()
    .trim()
    .min(1, "resources.validation.nameRequired")
    .max(60, "resources.validation.nameMax"),
  capacity: z.coerce
    .number()
    .int("resources.validation.capacityInteger")
    .min(1, "resources.validation.capacityMin")
    .max(200, "resources.validation.capacityMax"),
  status: z.enum(["available", "maintenance"]),
  active: z.boolean(),
});

const bulkSchema = z.object({
  type: z.enum(["seat", "room", "table"]),
  prefix: z
    .string()
    .trim()
    .min(1, "resources.validation.prefixRequired")
    .max(56, "resources.validation.prefixMax"),
  count: z.coerce
    .number()
    .int("resources.validation.countInteger")
    .min(1, "resources.validation.countMin")
    .max(200, "resources.validation.countMax"),
  capacity: z.coerce
    .number()
    .int("resources.validation.capacityInteger")
    .min(1, "resources.validation.capacityMin")
    .max(200, "resources.validation.capacityMax"),
});

type ResourceFormValues = z.output<typeof resourceSchema>;
type BulkFormValues = z.output<typeof bulkSchema>;
type ResourceDialog = { resource: Resource | null } | null;

const inputClassName =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const typeIcons: Record<ResourceType, typeof Armchair> = {
  seat: Armchair,
  room: Building2,
  table: Table2,
};

function matchesDateRange(value: string, from: string, to: string): boolean {
  const timestamp = new Date(value).getTime();
  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const endOfDay = to ? new Date(`${to}T00:00:00`) : null;
  endOfDay?.setDate(endOfDay.getDate() + 1);
  const toTime = endOfDay?.getTime() ?? null;
  return (fromTime === null || timestamp >= fromTime) &&
    (toTime === null || timestamp < toTime);
}

function getErrorKey(cause: unknown): string {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : "";
  if (message.includes("already checked in")) {
    return "resources.errors.customerAlreadyInside";
  }
  if (message.includes("resource is full")) {
    return "resources.errors.resourceFull";
  }
  if (message.includes("resource not available")) {
    return "resources.errors.resourceUnavailable";
  }
  if (message.includes("customer not allowed")) {
    return "resources.errors.customerNotAllowed";
  }
  if (message.includes("customer not found")) {
    return "resources.errors.customerNotFound";
  }
  if (message.includes("resource occupied")) {
    return "resources.errors.resourceOccupied";
  }
  if (message.includes("resource has active bookings")) {
    return "resources.errors.resourceHasBookings";
  }
  if (message.includes("not allowed")) {
    return "resources.errors.permission";
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505"
  ) {
    return "resources.errors.duplicate";
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "42501"
  ) {
    return "resources.errors.permission";
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23514"
  ) {
    return "resources.errors.resourceOccupied";
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === "42883" || cause.code === "PGRST202")
  ) {
    return "resources.errors.databaseMigrationRequired";
  }
  return "resources.errors.action";
}

export function ResourcesPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const canRegisterCustomers =
    permissions.includes("customers.view") &&
    permissions.includes("checkins.manage");
  const {
    resources,
    loading,
    error: loadError,
    reload: refresh,
  } = useResources();
  const [dialog, setDialog] = useState<ResourceDialog>(null);
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [resourceView, setResourceView] = useState<"all" | "active" | "archived">("all");
  const [resourceSearch, setResourceSearch] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType | "">("");
  const [resourceSort, setResourceSort] = useState<"name" | "newest" | "oldest">("name");
  const [resourceFrom, setResourceFrom] = useState("");
  const [resourceTo, setResourceTo] = useState("");
  const [registrationResource, setRegistrationResource] =
    useState<Resource | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerCandidates, setCustomerCandidates] = useState<
    ResourceCustomerCandidate[]
  >([]);
  const [selectedCandidate, setSelectedCandidate] =
    useState<ResourceCustomerCandidate | null>(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [registeringCustomer, setRegisteringCustomer] = useState(false);
  const [registrationError, setRegistrationError] = useState("");

  useEffect(() => {
    if (!registrationResource || !customerSearch.trim()) {
      setCustomerCandidates([]);
      setSearchingCustomers(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchingCustomers(true);
      void searchResourceCustomers(customerSearch)
        .then((candidates) => {
          if (!cancelled) setCustomerCandidates(candidates);
        })
        .catch(() => {
          if (!cancelled) {
            setRegistrationError(t("resources.errors.customerSearch"));
          }
        })
        .finally(() => {
          if (!cancelled) setSearchingCustomers(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerSearch, registrationResource, t]);

  const resourceForm = useForm<
    z.input<typeof resourceSchema>,
    unknown,
    ResourceFormValues
  >({
    resolver: zodResolver(resourceSchema),
    defaultValues: {
      type: "seat",
      name: "",
      capacity: 1,
      status: "available",
      active: true,
    },
  });
  const bulkForm = useForm<
    z.input<typeof bulkSchema>,
    unknown,
    BulkFormValues
  >({
    resolver: zodResolver(bulkSchema),
    defaultValues: {
      type: "seat",
      prefix: "Seat",
      count: 10,
      capacity: 1,
    },
  });
  const visibleResources = useMemo(() => {
    const term = resourceSearch.trim().toLocaleLowerCase();
    const collator = new Intl.Collator(i18n.language, { sensitivity: "base" });
    return resources
      .filter((resource) => {
        const matchesView = resourceView === "all" ||
          (resourceView === "active" ? resource.active : !resource.active);
        const matchesSearch = !term || [
          resource.name,
          resource.id,
          resource.type,
        ].some((value) => value.toLocaleLowerCase().includes(term));
        return matchesView &&
          (!resourceType || resource.type === resourceType) &&
          matchesSearch &&
          matchesDateRange(resource.created_at, resourceFrom, resourceTo);
      })
      .sort((left, right) => {
        if (resourceSort === "newest" || resourceSort === "oldest") {
          const direction = resourceSort === "newest" ? -1 : 1;
          return direction * (Date.parse(left.created_at) - Date.parse(right.created_at));
        }
        return collator.compare(left.name, right.name);
      });
  }, [i18n.language, resourceFrom, resourceSearch, resourceSort, resourceTo, resourceType, resourceView, resources]);
  const resourcePendingDeletion = resourceToDelete
    ? resources.find((resource) => resource.id === resourceToDelete.id) ??
      resourceToDelete
    : null;

  const openCreateDialog = () => {
    setToast(null);
    resourceForm.reset({
      type: "seat",
      name: "",
      capacity: 1,
      status: "available",
      active: true,
    });
    setDialog({ resource: null });
  };

  const openEditDialog = (resource: Resource) => {
    setToast(null);
    resourceForm.reset({
      type: resource.type,
      name: resource.name,
      capacity: resource.capacity,
      status: resource.status,
      active: resource.active,
    });
    setDialog({ resource });
  };

  const submitResource = resourceForm.handleSubmit(async (values) => {
    if (saving) return;
    setSaving(true);
    setToast(null);
    try {
      if (dialog?.resource) {
        await updateResource(dialog.resource.id, values);
      } else {
        await createResource(values);
      }
      setDialog(null);
      setToast({
        kind: "success",
        key:
          dialog?.resource
            ? "resources.toast.updated"
            : "resources.toast.created",
      });
      await refresh();
    } catch (cause) {
      setToast({ kind: "error", key: getErrorKey(cause) });
    } finally {
      setSaving(false);
    }
  });

  const submitBulk = bulkForm.handleSubmit(async (values) => {
    if (bulkSaving) return;
    setBulkSaving(true);
    setToast(null);
    try {
      const { created, skipped } = await bulkCreateResources(
        values.type,
        values.prefix,
        values.count,
        values.capacity,
      );
      setToast({
        kind: "success",
        key: "resources.toast.bulkCreated",
        params: { created, skipped },
      });
      await refresh();
    } catch (cause) {
      setToast({ kind: "error", key: getErrorKey(cause) });
    } finally {
      setBulkSaving(false);
    }
  });

  const toggleActive = async (resource: Resource) => {
    setUpdatingId(resource.id);
    setToast(null);
    try {
      await updateResource(resource.id, {
        type: resource.type,
        name: resource.name,
        capacity: resource.capacity,
        status: resource.status,
        active: !resource.active,
      });
      setToast({
        kind: "success",
        key: resource.active
          ? "resources.toast.deactivated"
          : "resources.toast.activated",
      });
      await refresh();
    } catch (cause) {
      setToast({ kind: "error", key: getErrorKey(cause) });
    } finally {
      setUpdatingId(null);
    }
  };

  const confirmDeleteResource = async () => {
    const currentResource = resourceToDelete
      ? resources.find((resource) => resource.id === resourceToDelete.id) ??
        resourceToDelete
      : null;
    if (!currentResource || deleting || currentResource.occupancy > 0) return;
    setDeleting(true);
    setDeleteError("");
    setToast(null);
    try {
      await deleteResource(currentResource.id);
      setResourceToDelete(null);
      setToast({ kind: "success", key: "resources.toast.deleted" });
      await refresh();
    } catch (cause) {
      setDeleteError(getErrorKey(cause));
    } finally {
      setDeleting(false);
    }
  };

  const openRegistration = (resource: Resource) => {
    setRegistrationResource(resource);
    setCustomerSearch("");
    setCustomerCandidates([]);
    setSelectedCandidate(null);
    setRegistrationError("");
  };

  const closeRegistration = () => {
    if (registeringCustomer) return;
    setRegistrationResource(null);
    setSelectedCandidate(null);
    setRegistrationError("");
  };

  const registerSelectedCustomer = async () => {
    if (!registrationResource || !selectedCandidate || registeringCustomer) {
      return;
    }
    setRegisteringCustomer(true);
    setRegistrationError("");
    try {
      if (selectedCandidate.checkinId !== null) {
        await assignCustomerToResource(
          selectedCandidate.checkinId,
          registrationResource.id,
        );
      } else {
        await checkInCustomerToResource(
          selectedCandidate.id,
          registrationResource.id,
        );
      }
      setRegistrationResource(null);
      setSelectedCandidate(null);
      setToast({
        kind: "success",
        key:
          selectedCandidate.checkinId !== null
            ? "resources.toast.customerAssigned"
            : "resources.toast.customerCheckedIn",
      });
      await refresh();
    } catch (cause) {
      setRegistrationError(t(getErrorKey(cause)));
    } finally {
      setRegisteringCustomer(false);
    }
  };

  const formError = (message?: string) =>
    message ? (
      <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
        {t(message)}
      </p>
    ) : null;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink dark:text-white">
            {t("pages.resources.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t("pages.resources.description")}
          </p>
        </div>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
          onClick={openCreateDialog}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          {t("resources.actions.create")}
        </button>
      </div>

      {toast && (
        <p
          className={`mt-5 rounded-lg border px-4 py-3 text-sm ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          }`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {t(toast.key, toast.params)}
        </p>
      )}

      <section className="mt-7 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand/10 p-2 text-brand">
            <Plus aria-hidden="true" size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink dark:text-white">
              {t("resources.bulk.title")}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t("resources.bulk.description")}
            </p>
          </div>
        </div>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={submitBulk}
        >
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("resources.fields.type")}
            <select className={inputClassName} {...bulkForm.register("type")}>
              {(["seat", "room", "table"] as const).map((type) => (
                <option key={type} value={type}>
                  {t(`resources.types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("resources.fields.prefix")}
            <input className={inputClassName} {...bulkForm.register("prefix")} />
            {formError(bulkForm.formState.errors.prefix?.message)}
          </label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("resources.fields.count")}
            <input
              className={inputClassName}
              inputMode="numeric"
              type="number"
              {...bulkForm.register("count")}
            />
            {formError(bulkForm.formState.errors.count?.message)}
          </label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("resources.fields.capacity")}
            <input
              className={inputClassName}
              inputMode="numeric"
              type="number"
              {...bulkForm.register("capacity")}
            />
            {formError(bulkForm.formState.errors.capacity?.message)}
          </label>
          <div className="flex items-end">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/5 disabled:opacity-60 dark:hover:bg-brand/10"
              disabled={bulkSaving}
              type="submit"
            >
              {bulkSaving ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={17}
                />
              ) : (
                <Plus aria-hidden="true" size={17} />
              )}
              {t(bulkSaving ? "resources.actions.creating" : "resources.actions.bulkCreate")}
            </button>
          </div>
        </form>
      </section>

      <div className="mt-7 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink dark:text-white">
          {t("resources.listTitle")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            aria-label={t("resources.actions.refresh")}
            className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            {loading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />
            ) : (
              <RefreshCw aria-hidden="true" size={17} />
            )}
          </button>
        </div>
      </div>
      <SearchFilterBar
        className="mt-4"
        onClear={() => {
          setResourceSearch("");
          setResourceView("all");
          setResourceType("");
          setResourceSort("name");
          setResourceFrom("");
          setResourceTo("");
        }}
        onSearchChange={setResourceSearch}
        search={resourceSearch}
        searchPlaceholder={t("resources.search")}
      >
        <label className="min-w-36">
          <span className="sr-only">{t("resources.fields.view")}</span>
          <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setResourceView(event.target.value as typeof resourceView)} value={resourceView}>
            <option value="all">{t("resources.filters.all")}</option>
            <option value="active">{t("resources.filters.active")}</option>
            <option value="archived">{t("resources.filters.archived")}</option>
          </select>
        </label>
        <label className="min-w-36">
          <span className="sr-only">{t("resources.fields.type")}</span>
          <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setResourceType(event.target.value as ResourceType | "")} value={resourceType}>
            <option value="">{t("resources.filters.allTypes")}</option>
            {(["seat", "room", "table"] as const).map((type) => <option key={type} value={type}>{t(`resources.types.${type}`)}</option>)}
          </select>
        </label>
        <label className="min-w-36">
          <span className="sr-only">{t("common.sort")}</span>
          <select className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setResourceSort(event.target.value as typeof resourceSort)} value={resourceSort}>
            <option value="name">{t("common.sortAlphabetically")}</option>
            <option value="newest">{t("common.sortNewest")}</option>
            <option value="oldest">{t("common.sortOldest")}</option>
          </select>
        </label>
        <label className="min-w-36">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("common.fromDate")}</span>
          <input aria-label={t("common.fromDate")} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setResourceFrom(event.target.value)} type="date" value={resourceFrom} />
        </label>
        <label className="min-w-36">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{t("common.toDate")}</span>
          <input aria-label={t("common.toDate")} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setResourceTo(event.target.value)} type="date" value={resourceTo} />
        </label>
      </SearchFilterBar>
      {!canRegisterCustomers && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          {t("resources.registration.permissionNotice")}
        </p>
      )}

      {Boolean(loadError) && (
        <>
          <div
            className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
          >
            <span>{t("resources.errors.load")}</span>
            <button
              className="font-semibold underline"
              disabled={loading}
              onClick={() => void refresh()}
              type="button"
            >
              {t("resources.actions.retry")}
            </button>
          </div>
        </>
      )}

      {loading ? (
        <div
          className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400"
          role="status"
        >
          <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
          {t("resources.loading")}
        </div>
      ) : !loadError && visibleResources.length === 0 ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {resources.length === 0
              ? t("resources.empty")
              : t("resources.emptyFilter")}
          </p>
          <button
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
            onClick={openCreateDialog}
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
            {t("resources.actions.create")}
          </button>
        </div>
      ) : (
        !loadError && (
          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[820px] border-collapse text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="px-4 py-3">{t("resources.columns.name")}</th>
                  <th className="px-4 py-3">{t("resources.columns.type")}</th>
                  <th className="px-4 py-3">{t("resources.columns.capacity")}</th>
                  <th className="px-4 py-3">{t("resources.columns.occupancy")}</th>
                  <th className="px-4 py-3">{t("resources.columns.status")}</th>
                  <th className="px-4 py-3">{t("resources.columns.active")}</th>
                  <th className="px-4 py-3">{t("resources.columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleResources.map((resource) => {
                  const Icon = typeIcons[resource.type];
                  const remaining = Math.max(
                    0,
                    resource.capacity - resource.occupancy,
                  );
                  return (
                    <tr
                      className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                        resource.occupancy > 0
                          ? "bg-amber-50/80 dark:bg-amber-950/20"
                          : ""
                      }`}
                      key={resource.id}
                    >
                      <td className="px-4 py-4 font-medium text-ink dark:text-slate-100">
                        <span className="inline-flex items-center gap-2">
                          <Icon aria-hidden="true" size={17} />
                          {resource.name}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                        {t(`resources.types.${resource.type}`)}
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                        {resource.capacity}
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              resource.occupancy > 0
                                ? "bg-amber-200 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {t("resources.occupancy", {
                              count: resource.occupancy,
                              capacity: resource.capacity,
                            })}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {t("resources.remaining", { count: remaining })}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                        {t(`resources.status.${resource.status}`)}
                      </td>
                      <td className="px-4 py-4">
                        <button
                          aria-pressed={resource.active}
                          aria-label={t(
                            resource.active
                              ? "resources.actions.archiveNamed"
                              : "resources.actions.restoreNamed",
                            { name: resource.name },
                          )}
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            resource.active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                          disabled={updatingId === resource.id}
                          onClick={() => void toggleActive(resource)}
                          type="button"
                        >
                          {t(
                            resource.active
                              ? "resources.actions.archive"
                              : "resources.actions.restore",
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          {canRegisterCustomers && (
                            <button
                              aria-label={t("resources.actions.registerCustomerFor", {
                                name: resource.name,
                              })}
                              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              disabled={
                                !resource.active ||
                                resource.status !== "available" ||
                                resource.occupancy >= resource.capacity
                              }
                              onClick={() => openRegistration(resource)}
                              type="button"
                            >
                              <UserPlus aria-hidden="true" size={16} />
                            </button>
                          )}
                          <button
                            aria-label={t("resources.actions.editNamed", {
                              name: resource.name,
                            })}
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            onClick={() => openEditDialog(resource)}
                            type="button"
                          >
                            <Pencil aria-hidden="true" size={16} />
                          </button>
                          <button
                            aria-label={t("resources.actions.deleteNamed", {
                              name: resource.name,
                            })}
                            className="inline-flex size-9 items-center justify-center rounded-lg border border-red-200 text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                            disabled={updatingId === resource.id}
                            onClick={() => {
                              setDeleteError("");
                              setResourceToDelete(resource);
                            }}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {dialog !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setDialog(null);
            }
          }}
        >
          <section
            aria-labelledby="resource-dialog-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                className="text-xl font-semibold text-ink dark:text-white"
                id="resource-dialog-title"
              >
                {t(
                  dialog.resource
                    ? "resources.dialog.editTitle"
                    : "resources.dialog.createTitle",
                )}
              </h2>
              <button
                aria-label={t("resources.actions.close")}
                className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                disabled={saving}
                onClick={() => setDialog(null)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={submitResource}>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("resources.fields.type")}
                <select
                  className={inputClassName}
                  {...resourceForm.register("type")}
                >
                  {(["seat", "room", "table"] as const).map((type) => (
                    <option key={type} value={type}>
                      {t(`resources.types.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("resources.fields.name")}
                <input
                  autoFocus
                  className={inputClassName}
                  {...resourceForm.register("name")}
                />
                {formError(resourceForm.formState.errors.name?.message)}
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("resources.fields.capacity")}
                <input
                  className={inputClassName}
                  inputMode="numeric"
                  type="number"
                  {...resourceForm.register("capacity")}
                />
                {formError(resourceForm.formState.errors.capacity?.message)}
              </label>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("resources.fields.status")}
                <select
                  className={inputClassName}
                  {...resourceForm.register("status")}
                >
                  {(["available", "maintenance"] as const).map(
                    (status: ResourceStatus) => (
                      <option key={status} value={status}>
                        {t(`resources.status.${status}`)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                <input
                  className="size-4 accent-brand"
                  type="checkbox"
                  {...resourceForm.register("active")}
                />
                {t("resources.fields.active")}
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  disabled={saving}
                  onClick={() => setDialog(null)}
                  type="button"
                >
                  {t("resources.actions.cancel")}
                </button>
                <button
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
                  disabled={saving}
                  type="submit"
                >
                  {saving && (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin"
                      size={16}
                    />
                  )}
                  {t(
                    saving
                      ? "resources.actions.saving"
                      : "resources.actions.save",
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {resourcePendingDeletion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setResourceToDelete(null);
              setDeleteError("");
            }
          }}
        >
          <section
            aria-labelledby="delete-resource-dialog-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
          >
            <h2
              className="text-xl font-semibold text-ink dark:text-white"
              id="delete-resource-dialog-title"
            >
              {t("resources.dialog.deleteTitle")}
            </h2>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {t("resources.dialog.deleteMessage", {
                name: resourcePendingDeletion.name,
              })}
            </p>
            {deleteError && (
              <div
                className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                <p>{t(deleteError)}</p>
              </div>
            )}
            {resourcePendingDeletion.occupancy > 0 && (
              <p
                className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                role="alert"
              >
                {t("resources.errors.resourceOccupied")}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                disabled={deleting}
                onClick={() => {
                  setResourceToDelete(null);
                  setDeleteError("");
                }}
                type="button"
              >
                {t("resources.actions.cancel")}
              </button>
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={
                  deleting || resourcePendingDeletion.occupancy > 0
                }
                onClick={() => void confirmDeleteResource()}
                type="button"
              >
                {deleting && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={16}
                  />
                )}
                {t("resources.actions.delete")}
              </button>
            </div>
          </section>
        </div>
      )}
      {registrationResource && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRegistration();
          }}
        >
          <section
            aria-labelledby="resource-customer-dialog-title"
            aria-modal="true"
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-xl font-semibold text-ink dark:text-white"
                  id="resource-customer-dialog-title"
                >
                  {t("resources.dialog.customerTitle")}
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {t("resources.registration.target", {
                    name: registrationResource.name,
                  })}
                </p>
              </div>
              <button
                aria-label={t("resources.actions.close")}
                className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                disabled={registeringCustomer}
                onClick={closeRegistration}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("resources.registration.search")}
              <span className="relative block">
                <Search
                  aria-hidden="true"
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={17}
                />
                <input
                  autoFocus
                  className={`${inputClassName} ps-10`}
                  onChange={(event) => {
                    setCustomerSearch(event.target.value);
                    setCustomerCandidates([]);
                    setSelectedCandidate(null);
                    setRegistrationError("");
                  }}
                  value={customerSearch}
                />
              </span>
            </label>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t("resources.registration.help")}
            </p>
            {registrationError && (
              <p
                className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                {registrationError}
              </p>
            )}
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {searchingCustomers ? (
                <p className="py-4 text-center text-sm text-slate-500">
                  {t("resources.registration.searching")}
                </p>
              ) : customerSearch.trim() && customerCandidates.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">
                  {t("resources.registration.noCustomers")}
                </p>
              ) : (
                customerCandidates.map((candidate) => (
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                      selectedCandidate?.id === candidate.id
                        ? "border-brand bg-brand/5"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                    key={candidate.id}
                  >
                    <input
                      checked={selectedCandidate?.id === candidate.id}
                      name="resource-customer"
                      onChange={() => setSelectedCandidate(candidate)}
                      type="radio"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {candidate.first_name} {candidate.last_name}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-slate-500">
                        {candidate.code}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {candidate.checkinId !== null
                          ? t("resources.registration.inside")
                          : t("resources.registration.notInside")}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="min-h-10 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
                disabled={registeringCustomer}
                onClick={closeRegistration}
                type="button"
              >
                {t("resources.actions.cancel")}
              </button>
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={!selectedCandidate || registeringCustomer}
                onClick={() => void registerSelectedCustomer()}
                type="button"
              >
                {registeringCustomer && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={16}
                  />
                )}
                {selectedCandidate && selectedCandidate.checkinId !== null
                  ? t("resources.actions.assignCustomer")
                  : t("resources.actions.checkInCustomer")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
