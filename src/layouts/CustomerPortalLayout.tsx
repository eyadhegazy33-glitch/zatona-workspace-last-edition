import { Link, Outlet } from "react-router-dom";
import { BrandingIdentity } from "../components/BrandingIdentity";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ThemeToggle } from "../components/ThemeToggle";
import { useTranslation } from "react-i18next";

export function CustomerPortalLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link aria-label={t("brand.name")} to="/customer/login">
          <BrandingIdentity />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 px-5 py-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {t("customerLoyalty.portalFooter")}
      </footer>
    </div>
  );
}
