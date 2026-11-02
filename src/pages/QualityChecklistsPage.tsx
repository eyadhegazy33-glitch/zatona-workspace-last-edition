import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LoaderCircle, Plus, Save } from "lucide-react";
import {
  loadTemplatesForManagement,
  saveChecklistTemplate,
  setChecklistActive,
  type QcItem,
  type QcItemInput,
  type QcTemplate,
} from "../services/quality";

type ItemDraft = QcItemInput & { key: string };

const editorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  area: z.string().trim().max(120),
  frequency: z.enum(["per_shift", "daily"]),
  dueTime: z.string(),
  items: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    critical: z.boolean(),
    sort: z.number().int().nonnegative(),
    active: z.boolean(),
  })).min(1),
});

function toDraft(item: QcItem): ItemDraft {
  return {
    id: item.id,
    key: item.id,
    text: item.text,
    critical: item.critical,
    sort: item.sort,
    active: item.active,
  };
}

export function QualityChecklistsPage() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<QcTemplate[]>([]);
  const [allItems, setAllItems] = useState<QcItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [frequency, setFrequency] = useState<"per_shift" | "daily">("per_shift");
  const [dueTime, setDueTime] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      const data = await loadTemplatesForManagement();
      setTemplates(data.templates);
      setAllItems(data.items);
    } catch {
      setErrorKey("quality.errors.load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetEditor = () => {
    setSelectedId(null);
    setName("");
    setArea("");
    setFrequency("per_shift");
    setDueTime("");
    setItems([]);
    setErrorKey(null);
  };

  const selectTemplate = (template: QcTemplate) => {
    setSelectedId(template.id);
    setName(template.name);
    setArea(template.area ?? "");
    setFrequency(template.frequency);
    setDueTime(template.due_time?.slice(0, 5) ?? "");
    setItems(allItems.filter((item) => item.template_id === template.id).map(toDraft));
    setErrorKey(null);
  };

  const addItem = () => {
    setItems((current) => [...current, {
      key: crypto.randomUUID(),
      text: "",
      critical: false,
      sort: current.length,
      active: true,
    }]);
  };

  const updateItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const ordered = [...current];
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return ordered.map((item, sort) => ({ ...item, sort }));
    });
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const parsed = editorSchema.safeParse({ name, area, frequency, dueTime, items });
    if (!parsed.success || (frequency === "daily" && !dueTime)) {
      setErrorKey("quality.errors.validation");
      return;
    }
    setSaving(true);
    setErrorKey(null);
    try {
      await saveChecklistTemplate(
        selectedId,
        {
          name: parsed.data.name,
          area: parsed.data.area || null,
          frequency: parsed.data.frequency,
          due_time: parsed.data.frequency === "daily" ? parsed.data.dueTime : null,
        },
        items.map(({ key: _key, ...item }, sort) => ({ ...item, sort })),
      );
      await refresh();
      resetEditor();
    } catch {
      setErrorKey("quality.errors.save");
    } finally {
      setSaving(false);
    }
  };

  const handleActive = async (template: QcTemplate) => {
    setErrorKey(null);
    try {
      await setChecklistActive(template.id, !template.active);
      await refresh();
    } catch {
      setErrorKey("quality.errors.save");
    }
  };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm font-semibold text-brand hover:underline" to="/quality">{t("quality.backToQuality")}</Link>
          <h1 className="mt-2 text-2xl font-semibold text-ink dark:text-white">{t("quality.manageTemplates")}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t("quality.manageDescription")}</p>
        </div>
        <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-white" onClick={resetEditor} type="button"><Plus size={16} />{t("quality.newTemplate")}</button>
      </header>
      {errorKey && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">{t(errorKey)}</p>}
      {loading ? <p className="mt-6 text-sm text-slate-500" role="status">{t("quality.loading")}</p> : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 font-semibold text-ink dark:text-white">{t("quality.templates")}</h2>
            <div className="space-y-2">
              {templates.map((template) => (
                <article key={template.id} className={`rounded-xl border p-3 ${selectedId === template.id ? "border-brand" : "border-slate-200 dark:border-slate-700"}`}>
                  <button className="w-full text-start" onClick={() => selectTemplate(template)} type="button">
                    <span className="block font-semibold text-ink dark:text-white">{template.name}</span>
                    <span className="mt-1 block text-xs text-slate-500">{template.frequency === "per_shift" ? t("quality.perShift") : t("quality.daily")}</span>
                  </button>
                  <button className="mt-2 text-xs font-semibold text-brand underline" onClick={() => void handleActive(template)} type="button">{template.active ? t("quality.deactivate") : t("quality.activate")}</button>
                </article>
              ))}
              {!templates.length && <p className="text-sm text-slate-500">{t("quality.emptyTemplates")}</p>}
            </div>
          </section>
          <form className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-6" onSubmit={(event) => void handleSave(event)}>
            <h2 className="text-lg font-semibold text-ink dark:text-white">{selectedId ? t("quality.editTemplate") : t("quality.newTemplate")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">{t("quality.fields.name")}<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></label>
              <label className="text-sm font-medium">{t("quality.fields.area")}<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" maxLength={120} onChange={(event) => setArea(event.target.value)} value={area} /></label>
              <label className="text-sm font-medium">{t("quality.fields.frequency")}<select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setFrequency(event.target.value as "per_shift" | "daily")} value={frequency}><option value="per_shift">{t("quality.perShift")}</option><option value="daily">{t("quality.daily")}</option></select></label>
              {frequency === "daily" && <label className="text-sm font-medium">{t("quality.fields.dueTime")}<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setDueTime(event.target.value)} required type="time" value={dueTime} /></label>}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <h3 className="font-semibold text-ink dark:text-white">{t("quality.items")}</h3>
              <button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700" onClick={addItem} type="button"><Plus size={15} />{t("quality.addItem")}</button>
            </div>
            <div className="space-y-3">
              {items.map((item, index) => (
                <article key={item.key} className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] ${item.active ? "border-slate-200 dark:border-slate-700" : "border-dashed border-slate-300 opacity-70 dark:border-slate-700"}`}>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium">{t("quality.fields.itemText")}<input className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" maxLength={300} onChange={(event) => updateItem(item.key, { text: event.target.value })} required value={item.text} /></label>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="inline-flex items-center gap-2"><input checked={item.critical} onChange={(event) => updateItem(item.key, { critical: event.target.checked })} type="checkbox" />{t("quality.critical")}</label>
                      <label className="inline-flex items-center gap-2"><input checked={item.active} onChange={(event) => updateItem(item.key, { active: event.target.checked })} type="checkbox" />{t("quality.active")}</label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button aria-label={t("quality.moveUp")} className="min-h-9 min-w-9 rounded border border-slate-300 dark:border-slate-700" disabled={index === 0} onClick={() => moveItem(index, -1)} type="button">↑</button>
                    <button aria-label={t("quality.moveDown")} className="min-h-9 min-w-9 rounded border border-slate-300 dark:border-slate-700" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} type="button">↓</button>
                  </div>
                </article>
              ))}
              {!items.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">{t("quality.addFirstItem")}</p>}
            </div>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}{saving ? t("quality.saving") : t("quality.save")}</button>
          </form>
        </div>
      )}
    </section>
  );
}
