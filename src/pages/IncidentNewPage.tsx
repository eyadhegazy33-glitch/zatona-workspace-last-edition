import { z } from "zod";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ImagePlus, LoaderCircle, X } from "lucide-react";
import {
  createIncident,
  uploadIncidentPhoto,
  type IncidentSeverity,
  type IncidentType,
} from "../services/incidents";

type PhotoDraft = { id: string; file: File };

const reportSchema = z.object({
  type: z.enum(["equipment", "customer", "cash", "safety", "cleaning", "quality", "power_internet", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  location: z.string().trim().max(200),
  photos: z.array(z.instanceof(File)).max(5),
});

const types: IncidentType[] = ["equipment", "customer", "cash", "safety", "cleaning", "quality", "power_internet", "other"];
const severities: IncidentSeverity[] = ["low", "medium", "high", "critical"];

function formErrorKey(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string" &&
    cause.message.toLowerCase().includes("not allowed")
  ) return "incidents.errors.permission";
  return "incidents.errors.submit";
}

export function IncidentNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [type, setType] = useState<IncidentType>("equipment");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = Math.max(0, 5 - photos.length);
    if (files.length > remaining) setErrorKey("incidents.errors.photoLimit");
    const selected = Array.from(files).slice(0, remaining);
    if (selected.some((file) => !file.type.startsWith("image/"))) {
      setErrorKey("incidents.errors.imagesOnly");
      return;
    }
    setPhotos((current) => [
      ...current,
      ...selected.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const parsed = reportSchema.safeParse({ type, severity, title, description, location, photos: photos.map((photo) => photo.file) });
    if (!parsed.success) {
      setErrorKey("incidents.errors.validation");
      return;
    }
    setSaving(true);
    setErrorKey(null);
    try {
      const photoPaths: string[] = [];
      for (const photo of photos) photoPaths.push(await uploadIncidentPhoto(photo.file));
      const incident = await createIncident({
        type,
        severity,
        title: parsed.data.title,
        description: parsed.data.description,
        location: parsed.data.location,
        photoPaths,
      });
      navigate(`/incidents/${incident.id}`, { replace: true });
    } catch (cause) {
      setErrorKey(formErrorKey(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink dark:text-white">{t("incidents.new.title")}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("incidents.new.description")}</p>
      </header>
      {errorKey && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t(errorKey)}</p>}
      <form className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-6" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">{t("incidents.fields.type")}
            <select className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setType(event.target.value as IncidentType)} value={type}>
              {types.map((value) => <option key={value} value={value}>{t(`incidents.types.${value}`)}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium">{t("incidents.fields.severity")}</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {severities.map((value) => (
                <button aria-pressed={severity === value} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold transition ${severity === value ? `ring-2 ring-offset-1 ${severityStyles[value]}` : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"} ${severityChips[value]}`} key={value} onClick={() => setSeverity(value)} type="button">{t(`incidents.severities.${value}`)}</button>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="block text-sm font-medium">{t("incidents.fields.title")}
          <input className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" maxLength={200} onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>
        <label className="block text-sm font-medium">{t("incidents.fields.description")}
          <textarea className="mt-1 min-h-28 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={2000} onChange={(event) => setDescription(event.target.value)} value={description} />
        </label>
        <label className="block text-sm font-medium">{t("incidents.fields.location")}
          <input className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" maxLength={200} onChange={(event) => setLocation(event.target.value)} value={location} />
        </label>
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{t("incidents.fields.photos")}</h2>
            <span className="text-xs text-slate-500">{t("incidents.photoCount", { count: photos.length, max: 5 })}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
              <ImagePlus size={17} />{t("incidents.new.takePhoto")}
              <input accept="image/*" capture="environment" className="sr-only" disabled={saving || photos.length >= 5} onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} type="file" />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
              <ImagePlus size={17} />{t("incidents.new.choosePhotos")}
              <input accept="image/*" className="sr-only" disabled={saving || photos.length >= 5} multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} type="file" />
            </label>
          </div>
          {photos.length > 0 && <ul className="mt-3 space-y-2">
            {photos.map((photo) => (
              <li className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950" key={photo.id}>
                <span className="min-w-0 truncate">{photo.file.name}</span>
                <button aria-label={t("incidents.new.removePhoto", { name: photo.file.name })} className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" disabled={saving} onClick={() => setPhotos((current) => current.filter((entry) => entry.id !== photo.id))} type="button"><X size={16} /></button>
              </li>
            ))}
          </ul>}
        </section>
        {severity === "critical" && <p className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"><AlertTriangle className="mt-0.5 shrink-0" size={17} />{t("incidents.new.criticalAlert")}</p>}
        <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-60 sm:w-auto" disabled={saving} type="submit">
          {saving && <LoaderCircle className="animate-spin" size={17} />}{saving ? t("incidents.new.submitting") : t("incidents.new.submit")}
        </button>
      </form>
    </section>
  );
}

const severityStyles: Record<IncidentSeverity, string> = {
  low: "ring-emerald-500",
  medium: "ring-amber-500",
  high: "ring-orange-500",
  critical: "ring-red-600",
};

const severityChips: Record<IncidentSeverity, string> = {
  low: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  medium: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  high: "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200",
  critical: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
};
