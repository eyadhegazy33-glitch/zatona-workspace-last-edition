import { RotateCcw, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type SearchFilterBarProps = {
  search: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  onClear: () => void;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function SearchFilterBar({
  search,
  searchPlaceholder,
  onSearchChange,
  onClear,
  children,
  className = "",
  ariaLabel,
}: SearchFilterBarProps) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}
      aria-label={ariaLabel}
    >
      <label className="relative min-w-[min(100%,16rem)] flex-1">
        <span className="sr-only">{searchPlaceholder}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400"
          size={17}
        />
        <input
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 ps-10 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          type="search"
          value={search}
        />
      </label>
      {children}
      <button
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        onClick={onClear}
        type="button"
      >
        <RotateCcw aria-hidden="true" size={15} />
        {t("common.clearFilters")}
      </button>
    </div>
  );
}
