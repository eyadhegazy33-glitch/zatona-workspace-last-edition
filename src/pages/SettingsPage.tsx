import { ImagePlus, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandingIdentity } from "../components/BrandingIdentity";
import { useBranding } from "../hooks/useBranding";
import { SettingsRulesTab } from "./SettingsRulesTab";
import {
  defaultBrandingSettings,
  isHexColor,
  removeBrandingImage,
  updateSetting,
  uploadBrandingImage,
  validateBrandingImage,
  type BrandingSettings,
} from "../services/settings";

const inputClassName =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

export function SettingsPage() {
  const { t } = useTranslation();
  const { settings, loading, error: loadError, refresh, preview } = useBranding();
  const [activeTab, setActiveTab] = useState<"branding" | "rules">("branding");
  const [draft, setDraft] = useState<BrandingSettings>(settings);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoChanged, setLogoChanged] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const updateDraft = (next: BrandingSettings) => {
    setDraft(next);
    preview(next);
    setSaved(false);
  };

  const onLogoChange = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSaved(false);
    try {
      validateBrandingImage(file);
      setLogoChanged(true);
      setLogoFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "settings.errors.imageType");
    }
  };

  const save = async () => {
    if (saving) return;
    if (!draft.workspaceName.trim()) {
      setError("settings.errors.workspaceName");
      return;
    }
    if (!isHexColor(draft.primaryColor) || !isHexColor(draft.secondaryColor)) {
      setError("settings.errors.invalidColor");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    let uploadedUrl: string | null = null;
    try {
      if (logoFile) {
        uploadedUrl = await uploadBrandingImage(logoFile);
      }

      await updateSetting("workspace_name", draft.workspaceName.trim());
      await updateSetting("primary_color", draft.primaryColor);
      await updateSetting("secondary_color", draft.secondaryColor);
      if (logoChanged) {
        await updateSetting("logo_url", uploadedUrl ?? draft.logoUrl);
      }

      await refresh();
      setLogoFile(null);
      setLogoChanged(false);
      setSaved(true);
    } catch (cause) {
      let messageKey = roleErrorKey(cause);
      if (uploadedUrl) {
        try {
          await removeBrandingImage(uploadedUrl);
        } catch {
          messageKey = "settings.errors.cleanupFailed";
        }
      }
      setError(messageKey);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setError(null);
    setSaved(false);
    setLogoFile(null);
    setLogoChanged(false);
    await refresh();
  };

  const logoUrl = logoPreview ?? draft.logoUrl;

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white">
          {t("pages.settings.title")}
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {t("pages.settings.description")}
        </p>
      </div>

      <div className="mt-7 border-b border-slate-200 dark:border-slate-800">
        <div
          aria-label={t("settings.tabs.label")}
          className="flex gap-6"
          role="tablist"
        >
          <button
            aria-controls="settings-branding-panel"
            aria-selected={activeTab === "branding"}
            className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
              activeTab === "branding"
                ? "border-brand text-brand"
                : "border-transparent text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
            }`}
            id="settings-branding-tab"
            onClick={() => setActiveTab("branding")}
            role="tab"
            type="button"
          >
            {t("settings.tabs.branding")}
          </button>
          <button
            aria-controls="settings-rules-panel"
            aria-selected={activeTab === "rules"}
            className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
              activeTab === "rules"
                ? "border-brand text-brand"
                : "border-transparent text-slate-500 hover:text-ink dark:text-slate-400 dark:hover:text-white"
            }`}
            id="settings-rules-tab"
            onClick={() => setActiveTab("rules")}
            role="tab"
            type="button"
          >
            {t("settings.tabs.rules")}
          </button>
        </div>
      </div>

      {activeTab === "branding" && loadError && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>{t("settings.errors.load")}</p>
          <button
            className="mt-2 font-semibold underline underline-offset-2"
            onClick={() => void refresh()}
            type="button"
          >
            {t("settings.actions.retry")}
          </button>
        </div>
      )}

      {activeTab === "branding" && error && (
        <p
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {t(error)}
        </p>
      )}
      {activeTab === "branding" && saved && (
        <p
          className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {t("settings.toast.saved")}
        </p>
      )}

      {activeTab === "branding" && (
        <div
          aria-labelledby="settings-branding-tab"
          className="mt-6"
          id="settings-branding-panel"
          role="tabpanel"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <h2 className="text-lg font-semibold text-ink dark:text-white">
              {t("settings.branding.title")}
            </h2>

            <label className="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {t("settings.branding.workspaceName")}
              <input
                className={inputClassName}
                maxLength={80}
                onChange={(event) =>
                  updateDraft({ ...draft, workspaceName: event.target.value })
                }
                value={draft.workspaceName}
              />
            </label>

            <div className="mt-6">
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                {t("settings.branding.logo")}
              </span>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t("settings.branding.logoHelp")}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                  {logoUrl ? (
                    <img
                      alt={t("settings.branding.logoPreview")}
                      className="size-full object-contain p-2"
                      src={logoUrl}
                    />
                  ) : (
                    <ImagePlus
                      aria-hidden="true"
                      className="text-slate-400"
                      size={26}
                    />
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  {t("settings.actions.uploadLogo")}
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    onChange={(event) => {
                      onLogoChange(event.currentTarget.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
                {(logoFile || draft.logoUrl) && (
                  <button
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    onClick={() => {
                      setLogoFile(null);
                      setLogoChanged(true);
                      updateDraft({ ...draft, logoUrl: null });
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={16} />
                    {t("settings.actions.removeLogo")}
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <h2 className="text-lg font-semibold text-ink dark:text-white">
              {t("settings.branding.colors")}
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <ColorField
                label={t("settings.branding.primaryColor")}
                value={draft.primaryColor}
                onChange={(primaryColor) =>
                  updateDraft({ ...draft, primaryColor })
                }
              />
              <ColorField
                label={t("settings.branding.secondaryColor")}
                value={draft.secondaryColor}
                onChange={(secondaryColor) =>
                  updateDraft({ ...draft, secondaryColor })
                }
              />
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-ink dark:text-white">
            {t("settings.preview.title")}
          </h2>
          <div className="mt-4 rounded-xl border border-slate-200 bg-canvas p-4 dark:border-slate-700 dark:bg-slate-950">
            <BrandingIdentity />
            <div className="mt-5 rounded-lg bg-white p-4 shadow-sm dark:bg-slate-900">
              <p className="text-sm font-semibold text-ink dark:text-white">
                {t("settings.preview.sampleTitle")}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t("settings.preview.sampleDescription")}
              </p>
              <button
                className="mt-4 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
                type="button"
              >
                {t("settings.preview.primaryButton")}
              </button>
              <span
                className="ms-2 inline-block rounded-lg px-3 py-2 text-xs font-semibold text-white"
                style={{ backgroundColor: draft.secondaryColor }}
              >
                {t("settings.preview.secondaryButton")}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          disabled={saving || loading}
          onClick={() => void reset()}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
          {t("settings.actions.discard")}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={saving || loading}
          onClick={() => void save()}
          type="button"
        >
          {saving ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
          ) : (
            <Save aria-hidden="true" size={16} />
          )}
          {saving ? t("settings.actions.saving") : t("settings.actions.save")}
        </button>
      </div>
        </div>
      )}
      <div
        aria-labelledby="settings-rules-tab"
        hidden={activeTab !== "rules"}
        id="settings-rules-panel"
        role="tabpanel"
      >
        <SettingsRulesTab />
      </div>
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
      {label}
      <div className="mt-1.5 flex items-center gap-3">
        <input
          aria-label={label}
          className="size-11 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-950"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={isHexColor(value) ? value : defaultBrandingSettings.primaryColor}
        />
        <input
          className={`${inputClassName} mt-0 font-mono uppercase`}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("settings.branding.colorPlaceholder")}
          value={value}
        />
      </div>
    </label>
  );
}

function roleErrorKey(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  return message.startsWith("settings.errors.")
    ? message
    : "settings.errors.save";
}
