import { z } from "zod";
import { LoaderCircle, Star, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { recordCustomerFeedback } from "../services/quality";

type Props = {
  customerId: string | null;
  onClose: () => void;
};

const feedbackFormSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500),
});

export function CustomerFeedbackDialog({ customerId, onClose }: Props) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || saved) return;
    const parsed = feedbackFormSchema.safeParse({ rating, comment });
    if (!parsed.success) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await recordCustomerFeedback(customerId, parsed.data.rating, parsed.data.comment);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section aria-labelledby="customer-feedback-title" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:p-6" role="dialog">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink dark:text-white" id="customer-feedback-title">{t("quality.feedback.title")}</h2>
          <button aria-label={t("quality.feedback.close")} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" disabled={saving} onClick={onClose} type="button"><X size={18} /></button>
        </div>
        {saved ? (
          <div className="mt-5">
            <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" role="status">{t("quality.feedback.saved")}</p>
            <button className="mt-4 min-h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white" onClick={onClose} type="button">{t("quality.feedback.done")}</button>
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
            <fieldset>
              <legend className="text-sm font-medium">{t("quality.feedback.rating")}</legend>
              <div className="mt-2 flex gap-2" dir="ltr">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button aria-label={t("quality.feedback.ratingValue", { count: value })} aria-pressed={rating === value} className={`rounded-lg p-2 ${value <= rating ? "text-amber-500" : "text-slate-300 dark:text-slate-600"}`} key={value} onClick={() => setRating(value)} type="button">
                    <Star fill={value <= rating ? "currentColor" : "none"} size={25} />
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm font-medium">{t("quality.feedback.comment")}<textarea className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" maxLength={500} onChange={(event) => setComment(event.target.value)} value={comment} /></label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">{rating ? t("quality.feedback.error") : t("quality.feedback.ratingRequired")}</p>}
            <div className="flex justify-end gap-2">
              <button className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700" disabled={saving} onClick={onClose} type="button">{t("quality.feedback.cancel")}</button>
              <button className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">{saving && <LoaderCircle className="animate-spin" size={16} />}{saving ? t("quality.feedback.saving") : t("quality.feedback.submit")}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
