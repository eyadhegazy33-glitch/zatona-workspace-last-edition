import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getAlertOverview, type AlertOverview } from "../services/alerts";
import { getSupabaseClient } from "../lib/supabase";

export function useAlertOverview(enabled: boolean) {
  const [overview, setOverview] = useState<AlertOverview | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOverview(await getAlertOverview());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setOverview(null);
      setError(false);
      return;
    }

    let debounce: number | undefined;
    let channel: RealtimeChannel | null = null;
    void refresh();
    channel = getSupabaseClient()
      .channel(`alert-overview-${crypto.randomUUID()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "alerts",
      }, () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void refresh(), 300);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError(true);
      });

    return () => {
      window.clearTimeout(debounce);
      if (channel) void getSupabaseClient().removeChannel(channel);
    };
  }, [enabled, refresh]);

  return { overview, error, retry: refresh };
}
