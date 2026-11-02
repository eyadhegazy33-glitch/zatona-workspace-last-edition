import { Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "../hooks/useAuth";
import { getSupabaseClient } from "../lib/supabase";
import {
  getOrderDetail,
  listOrderBoard,
  setOrderStatus,
  type OrderBoardRecord,
  type OrderStatus,
} from "../services/orders";

const ORDER_WAIT_WARNING_MS = 5 * 60 * 1000;
const ORDER_WAIT_CRITICAL_MS = 10 * 60 * 1000;
const ORDER_BOARD_MUTED_KEY = "zatona.orders.board.muted";

function readMuted(): boolean {
  try {
    return localStorage.getItem(ORDER_BOARD_MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

function createAudioContext(): AudioContext {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Audio is not supported.");
  return new AudioContextConstructor();
}

function playNewOrderSound(context: AudioContext): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.25);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.26);
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}

function orderErrorKey(cause: unknown): string {
  const message =
    cause && typeof cause === "object" && "message" in cause
      ? String(cause.message).toLowerCase()
      : "";
  if (message.includes("not allowed")) return "ordersBoard.errors.permission";
  return "ordersBoard.errors.load";
}

const columns: Array<{
  status: "new" | "preparing" | "ready";
  next: "preparing" | "ready" | "served";
}> = [
  { status: "new", next: "preparing" },
  { status: "preparing", next: "ready" },
  { status: "ready", next: "served" },
];

export function OrderBoardPage() {
  const { i18n, t } = useTranslation();
  const { permissions } = useAuth();
  const [orders, setOrders] = useState<OrderBoardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [muted, setMuted] = useState(readMuted);
  const [soundError, setSoundError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const mutedRef = useRef(muted);
  const audioContextRef = useRef<AudioContext | null>(null);
  const wasConnectedRef = useRef(false);
  const canUpdate = permissions.includes("orders.update_status") ||
    permissions.includes("orders.manage");
  const canCreateOrder = permissions.includes("orders.create") ||
    permissions.includes("orders.manage");

  useEffect(() => {
    mutedRef.current = muted;
    try {
      localStorage.setItem(ORDER_BOARD_MUTED_KEY, String(muted));
    } catch {
      setStorageError(true);
    }
  }, [muted]);

  const refreshBoard = useCallback(async () => {
    setError("");
    try {
      setOrders(await listOrderBoard());
    } catch (cause) {
      setError(orderErrorKey(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel;
    const client = getSupabaseClient();
    channel = client
      .channel("pos-orders-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_orders" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deletedId = String(payload.old.id ?? "");
            setOrders((current) => current.filter((order) => order.id !== deletedId));
            return;
          }

          const orderId = String(payload.new.id ?? "");
          if (!orderId) return;
          if (payload.eventType === "INSERT" && !mutedRef.current) {
            try {
              if (!audioContextRef.current || audioContextRef.current.state === "closed") {
                audioContextRef.current = createAudioContext();
              }
              if (audioContextRef.current.state !== "running") {
                void audioContextRef.current.resume().catch(() => setSoundError(true));
              }
              playNewOrderSound(audioContextRef.current);
              setSoundError(false);
            } catch {
              setSoundError(true);
            }
          }

          void getOrderDetail(orderId)
            .then((detail) => {
              if (!active) return;
              if (
                detail.status !== "new" &&
                detail.status !== "preparing" &&
                detail.status !== "ready"
              ) {
                setOrders((current) => current.filter((order) => order.id !== orderId));
                return;
              }
              const nextOrder: OrderBoardRecord = {
                id: detail.id,
                order_number: detail.order_number,
                status: detail.status,
                customer_first_name: detail.customer_first_name,
                created_at: detail.created_at,
                items: detail.items,
              };

              setOrders((current) => {
                const exists = current.some((order) => order.id === orderId);
                return exists
                  ? current.map((order) => order.id === orderId ? nextOrder : order)
                  : [...current, nextOrder].sort(
                      (left, right) =>
                        Date.parse(left.created_at) - Date.parse(right.created_at),
                    );
              });
            })
            .catch((cause: unknown) => {
              if (active) setError(orderErrorKey(cause));
            });
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          setConnectionStatus("connected");
          if (wasConnectedRef.current) void refreshBoard();
          wasConnectedRef.current = true;
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setConnectionStatus("disconnected");
        }
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [refreshBoard]);

  const moveOrder = async (
    orderId: string,
    next: "preparing" | "ready" | "served",
  ) => {
    if (busyOrder) return;
    setBusyOrder(orderId);
    setError("");
    try {
      await setOrderStatus(orderId, next);
      if (next === "served") {
        setOrders((current) => current.filter((order) => order.id !== orderId));
      } else {
        setOrders((current) =>
          current.map((order) => order.id === orderId ? { ...order, status: next } : order),
        );
      }
    } catch (cause) {
      setError(orderErrorKey(cause));
      void refreshBoard();
    } finally {
      setBusyOrder(null);
    }
  };

  const toggleMuted = () => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = createAudioContext();
      }
      if (audioContextRef.current.state !== "running") {
        void audioContextRef.current.resume().catch(() => setSoundError(true));
      }
    } catch {
      setSoundError(true);
    }
    setMuted((value) => !value);
  };

  const formatElapsed = (createdAt: string) => {
    const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  const statusLabel = (value: OrderStatus) => t(`ordersBoard.status.${value}`);

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">
            {t("ordersBoard.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink dark:text-white">
            {t("ordersBoard.title")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateOrder && (
            <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90" to="/orders/new">
              {t("layout.navigation.newOrder")}
            </Link>
          )}
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/orders">
            {t("layout.navigation.ordersList")}
          </Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" to="/pos">
            {t("layout.navigation.pos")}
          </Link>
          <div
            aria-live="polite"
            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium ${
              connectionStatus === "connected"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            }`}
          >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${
                  connectionStatus === "connected" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {connectionStatus === "connected" ? <Wifi size={16} /> : <WifiOff size={16} />}
              {t(`ordersBoard.connection.${connectionStatus}`)}
          </div>
          <button
            aria-pressed={muted}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={toggleMuted}
            type="button"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            {t(muted ? "ordersBoard.unmute" : "ordersBoard.mute")}
          </button>
        </div>
      </header>

      {connectionStatus === "disconnected" && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          {t("ordersBoard.reconnecting")}
        </p>
      )}
      {storageError && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          {t("ordersBoard.errors.storage")}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alert">
          {t(error)}
          <button className="ms-2 font-semibold underline" onClick={() => void refreshBoard()} type="button">
            {t("ordersBoard.retry")}
          </button>
        </p>
      )}
      {soundError && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          {t("ordersBoard.errors.sound")}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-slate-500">{t("ordersBoard.loading")}</p>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-3">
          {columns.map(({ status, next }) => {
            const columnOrders = orders.filter((order) => order.status === status);
            return (
              <section
                aria-label={statusLabel(status)}
                className="min-w-0 rounded-2xl bg-slate-100 p-3 dark:bg-slate-900/70 sm:p-4"
                key={status}
              >
                <header className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h2 className="text-lg font-bold text-ink dark:text-white">{statusLabel(status)}</h2>
                  <span className="rounded-full bg-white px-2.5 py-1 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {columnOrders.length}
                  </span>
                </header>
                <div className="space-y-3">
                  {columnOrders.map((order) => {
                    const elapsed = now - Date.parse(order.created_at);
                    const waitClass = elapsed >= ORDER_WAIT_CRITICAL_MS
                      ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                      : elapsed >= ORDER_WAIT_WARNING_MS
                        ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
                        : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950";
                    return (
                      <article
                        className={`rounded-2xl border p-4 shadow-sm ${waitClass}`}
                        key={order.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-extrabold text-ink dark:text-white">
                              {t("ordersBoard.orderNumber", { number: order.order_number })}
                            </h3>
                            <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">
                              {order.customer_first_name}
                            </p>
                          </div>
                          <time className="shrink-0 rounded-lg bg-white/80 px-2.5 py-1 font-mono text-lg font-bold tabular-nums text-slate-800 dark:bg-slate-900 dark:text-slate-100">
                            {formatElapsed(order.created_at)}
                          </time>
                        </div>
                        <ul className="mt-4 space-y-2 border-t border-slate-300/70 pt-3 dark:border-slate-700">
                          {order.items.map((item, index) => (
                            <li className="text-sm" key={`${item.name_en}-${index}`}>
                              <p className="font-semibold text-ink dark:text-white">
                                {i18n.language.startsWith("ar") ? item.name_ar : item.name_en}
                                <span className="ms-2 text-base font-extrabold">× {item.quantity}</span>
                              </p>
                              {item.note && (
                                <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                                  {t("ordersBoard.note")}: {item.note}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                        {canUpdate && (
                          <button
                            className="mt-4 min-h-14 w-full rounded-xl bg-brand px-4 py-3 text-base font-bold text-white transition hover:bg-brand/90 disabled:cursor-wait disabled:opacity-60"
                            disabled={busyOrder !== null}
                            onClick={() => void moveOrder(order.id, next)}
                            type="button"
                          >
                            {busyOrder === order.id
                              ? t("ordersBoard.updating")
                              : t(`ordersBoard.advance.${next}`)}
                          </button>
                        )}
                      </article>
                    );
                  })}
                  {columnOrders.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
                      {t("ordersBoard.empty")}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
