import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  defaultBrandingSettings,
  getBrandingSettings,
  type BrandingSettings,
} from "../services/settings";

type BrandingContextValue = {
  settings: BrandingSettings;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  preview: (settings: BrandingSettings) => void;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultBrandingSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSettings(defaultBrandingSettings);
      setError(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      setSettings(await getBrandingSettings());
      setError(false);
    } catch {
      setSettings(defaultBrandingSettings);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--color-primary",
      hexToRgbChannels(settings.primaryColor),
    );
    document.documentElement.style.setProperty(
      "--color-secondary",
      hexToRgbChannels(settings.secondaryColor),
    );
  }, [settings.primaryColor, settings.secondaryColor]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      settings,
      loading,
      error,
      refresh,
      preview: setSettings,
    }),
    [settings, loading, error, refresh],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBranding must be used within a BrandingProvider.");
  }
  return context;
}

function hexToRgbChannels(color: string): string {
  const value = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return "49 92 69";
  const channels = value.match(/.{2}/g);
  if (!channels) return "49 92 69";
  return channels.map((channel) => Number.parseInt(channel, 16)).join(" ");
}
