import { Bell, CheckCheck, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getSupabaseClient } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

type UserNotification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type NotificationBellProps = {
  userId: string;
};

export function NotificationBell({ userId }: NotificationBellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    const { data, error: queryError } = await getSupabaseClient()
      .from("notifications")
      .select("id, type, payload, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (queryError) {
      throw queryError;
    }

    setNotifications(data as UserNotification[]);
    setError(false);
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    let channel: RealtimeChannel | null = null;

    setLoading(true);
    void loadNotifications()
      .catch(() => {
        if (mounted) {
          setError(true);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    channel = getSupabaseClient()
      .channel(`user-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void loadNotifications().catch(() => {
            if (mounted) {
              setError(true);
            }
          });
        },
      )
      .subscribe((status) => {
        if (!mounted) {
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(true);
        }
      });

    return () => {
      mounted = false;
      if (channel) {
        void getSupabaseClient().removeChannel(channel);
      }
    };
  }, [loadNotifications, userId]);

  const unreadCount = notifications.filter(
    (notification) => notification.read_at === null,
  ).length;

  const handleNotificationClick = async (
    notification: UserNotification,
  ) => {
    if (notification.read_at === null) {
      setMarkingId(notification.id);

      try {
        const { error: updateError } = await getSupabaseClient()
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", notification.id)
          .eq("user_id", userId)
          .is("read_at", null);

        if (updateError) {
          throw updateError;
        }

        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id
              ? { ...item, read_at: new Date().toISOString() }
              : item,
          ),
        );
      } catch {
        setError(true);
        setMarkingId(null);
        return;
      }

      setMarkingId(null);
    }

    setOpen(false);
    if (notification.type === "account_pending") {
      navigate("/admin/pending-accounts");
    }
  };

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={t("notifications.open", { count: unreadCount })}
        className="relative inline-flex size-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-ink transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Bell aria-hidden="true" size={18} />
        {unreadCount > 0 && (
          <span className="absolute -end-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-5 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          aria-label={t("notifications.title")}
          className="absolute end-0 top-12 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
          role="region"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-ink dark:text-white">
              {t("notifications.title")}
            </h2>
            {loading && (
              <LoaderCircle
                aria-label={t("notifications.loading")}
                className="animate-spin text-slate-500"
                size={16}
              />
            )}
          </div>

          {error && (
            <p
              className="px-4 py-3 text-sm text-red-700 dark:text-red-300"
              role="alert"
            >
              {t("notifications.error")}
            </p>
          )}

          {!loading && notifications.length === 0 && !error && (
            <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">
              {t("notifications.empty")}
            </p>
          )}

          {notifications.length > 0 && (
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    className={`flex w-full items-start gap-3 px-4 py-3 text-start transition hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      notification.read_at === null
                        ? "bg-emerald-50/70 dark:bg-emerald-950/20"
                        : ""
                    }`}
                    disabled={markingId === notification.id}
                    onClick={() => void handleNotificationClick(notification)}
                    type="button"
                  >
                    {notification.read_at === null ? (
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-brand"
                      />
                    ) : (
                      <CheckCheck
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-slate-400"
                        size={16}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink dark:text-slate-100">
                        {t(`notifications.types.${notification.type}`, {
                          defaultValue: t("notifications.types.default"),
                        })}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {new Date(notification.created_at).toLocaleString()}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
