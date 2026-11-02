import { useTranslation } from "react-i18next";

type PlaceholderPageProps = {
  descriptionKey: string;
  titleKey: string;
};

export function PlaceholderPage({
  descriptionKey,
  titleKey,
}: PlaceholderPageProps) {
  const { t } = useTranslation();

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink dark:text-white sm:text-4xl">
        {t(titleKey)}
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-400">
        {t(descriptionKey)}
      </p>
    </section>
  );
}
