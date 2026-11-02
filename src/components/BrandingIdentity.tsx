import { useBranding } from "../hooks/useBranding";

type BrandingIdentityProps = {
  compact?: boolean;
  className?: string;
};

export function BrandingIdentity({
  compact = false,
  className = "",
}: BrandingIdentityProps) {
  const { settings } = useBranding();
  const workspaceName = settings.workspaceName || "elzatona";

  return (
    <span className={`flex min-w-0 items-center gap-3 ${className}`}>
      {settings.logoUrl ? (
        <img
          alt=""
          className={`shrink-0 rounded-xl object-contain ${
            compact ? "size-9" : "size-11"
          }`}
          src={settings.logoUrl}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-brand text-lg font-semibold text-white ${
            compact ? "size-9 text-sm" : "size-11"
          }`}
        >
          {workspaceName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate text-sm font-medium text-slate-600 dark:text-slate-300">
        {workspaceName}
      </span>
    </span>
  );
}
