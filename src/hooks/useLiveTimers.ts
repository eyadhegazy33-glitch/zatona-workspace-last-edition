import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { getLiveTimers, type LiveTimer } from "../services/timers";

type LiveTimersState = {
  timers: LiveTimer[];
  serverOffsetMs: number;
  now: number;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useLiveTimers(enabled = true): LiveTimersState {
  const [timers, setTimers] = useState<LiveTimer[]>([]);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const nextTimers = await getLiveTimers();
      setTimers(nextTimers);
      if (nextTimers[0]) {
        const serverTime = Date.parse(nextTimers[0].server_now);
        if (Number.isFinite(serverTime)) {
          setServerOffsetMs(serverTime - Date.now());
        }
      }
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
    const tickId = window.setInterval(() => setNow(Date.now()), 1000);
    const pollId = window.setInterval(() => void refresh(), 30_000);
    let debounceId: number | null = null;
    const client = getSupabaseClient();
    const scheduleRefresh = () => {
      if (debounceId !== null) window.clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        debounceId = null;
        void refresh();
      }, 1000);
    };
    const channel = client
      .channel(`live-timers-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_orders" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "fees" }, scheduleRefresh)
      .subscribe();

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(pollId);
      if (debounceId !== null) window.clearTimeout(debounceId);
      void client.removeChannel(channel);
    };
  }, [enabled, refresh]);

  return { timers, serverOffsetMs, now, loading, error, refresh };
}
