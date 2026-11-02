import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import {
  listResources,
  type Resource,
} from "../services/resources";

export function useResources(options: { onlyUsable?: boolean } = {}) {
  const { onlyUsable = false } = options;
  const [resources, setResources] = useState<Resource[]>([]);
  const [occupancyByResource, setOccupancyByResource] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await listResources();
      const nextResources = onlyUsable
        ? loaded.resources.filter(
            (resource) =>
              resource.active &&
              resource.status === "available" &&
              resource.occupancy < resource.capacity,
          )
        : loaded.resources;
      setResources(nextResources);
      setOccupancyByResource(loaded.occupancyByResource);
      setError(null);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, [onlyUsable]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let client: ReturnType<typeof getSupabaseClient> | null = null;
    try {
      client = getSupabaseClient();
    } catch (reason) {
      setError(reason);
      return;
    }
    let debounceTimer: number | undefined;
    const channel = client
      .channel(`resource-occupancy-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checkins" },
        () => {
          window.clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(() => void reload(), 1000);
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(debounceTimer);
      if (client) void client.removeChannel(channel);
    };
  }, [reload]);

  return { resources, occupancyByResource, loading, error, reload };
}
