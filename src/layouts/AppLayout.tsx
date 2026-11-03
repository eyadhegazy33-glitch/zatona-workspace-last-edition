import {
  BriefcaseBusiness,
  Award,
  Boxes,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ChartNoAxesCombined,
  CalendarDays,
  Gift,
  BellRing,
  Clock3,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  LogOut,
  Menu,
  MapPinned,
  Printer,
  ReceiptText,
  ScanLine,
  Settings,
  ShoppingBasket,
  Shield,
  ShoppingCart,
  Timer,
  TriangleAlert,
  UsersRound,
  Utensils,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { BrandingIdentity } from "../components/BrandingIdentity";
import { NotificationBell } from "../components/NotificationBell";
import { ShiftIndicator } from "../components/ShiftIndicator";
import { ThemeToggle } from "../components/ThemeToggle";
import { AlertCriticalBanner } from "../components/AlertCriticalBanner";
import { useAuth } from "../hooks/useAuth";
import { useBranding } from "../hooks/useBranding";
import { useAlertOverview } from "../hooks/useAlertOverview";

type NavigationItem = {
  labelKey: string;
  path: string;
  permission?: string | string[];
  icon: typeof ChartNoAxesCombined;
  sidebar?: boolean;
};

const SIDEBAR_WIDTH_KEY = "zatona.sidebar.width";
const SIDEBAR_COLLAPSED_KEY = "zatona.sidebar.collapsed";
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_TABLET_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;

function readStoredSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored) {
      const width = Number(stored);
      if (Number.isFinite(width)) {
        return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
      }
    }
  } catch {
    // Continue with the responsive default if storage is unavailable.
  }
  return typeof window !== "undefined" && window.innerWidth < 1024
    ? SIDEBAR_TABLET_WIDTH
    : SIDEBAR_DEFAULT_WIDTH;
}

function readStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

const navigationItems: NavigationItem[] = [
  {
    labelKey: "layout.navigation.dashboard",
    path: "/dashboard",
    icon: ChartNoAxesCombined,
  },
  {
    labelKey: "layout.navigation.pendingAccounts",
    path: "/admin/pending-accounts",
    permission: "accounts.approve",
    icon: ClipboardCheck,
  },
  {
    labelKey: "layout.navigation.scan",
    path: "/scan",
    permission: "scanner.use",
    icon: ScanLine,
  },
  {
  labelKey: "layout.navigation.timers",
  path: "/timers",
  permission: "timers.view",
  icon: Timer,
  },
  {
    labelKey: "layout.navigation.bookings",
    path: "/bookings",
    permission: "bookings.view",
    icon: CalendarRange,
  },
  {
    labelKey: "layout.navigation.inventory",
    path: "/inventory",
    permission: "inventory.view",
    icon: Boxes,
  },
  {
    labelKey: "layout.navigation.quality",
    path: "/quality",
    permission: "qc.fill",
    icon: ClipboardCheck,
  },
  {
    labelKey: "layout.navigation.incidents",
    path: "/incidents",
    permission: ["incidents.view", "incidents.report", "incidents.manage"],
    icon: TriangleAlert,
  },
  {
    labelKey: "layout.navigation.alerts",
    path: "/alerts",
    permission: "alerts.view",
    icon: BellRing,
  },
  {
    labelKey: "layout.navigation.pos",
    path: "/pos",
    permission: "orders.view",
    icon: ShoppingBasket,
  },
  {
    labelKey: "layout.navigation.myShifts",
    path: "/shifts/my",
    permission: "shifts.use",
    icon: CalendarDays,
  },
  {
    labelKey: "layout.navigation.currentShift",
    path: "/shifts/current",
    permission: "shifts.use",
    icon: Clock3,
  },
  {
    labelKey: "layout.navigation.receipts",
    path: "/receipts",
    permission: ["receipts.view", "receipts.view_own"],
    icon: ReceiptText,
  },
  {
    labelKey: "layout.navigation.ordersBoard",
    path: "/orders/board",
    permission: "orders.view",
    icon: Columns3,
    sidebar: false,
  },
  {
    labelKey: "layout.navigation.ordersList",
    path: "/orders",
    permission: "orders.view",
    icon: ClipboardList,
    sidebar: false,
  },
  {
    labelKey: "layout.navigation.newOrder",
    path: "/orders/new",
    permission: ["orders.create", "orders.manage"],
    icon: ShoppingCart,
  },
  {
    labelKey: "layout.navigation.customers",
    path: "/customers",
    permission: "customers.view",
    icon: UsersRound,
  },
  {
    labelKey: "layout.navigation.customerCards",
    path: "/customers/cards/print",
    permission: "customers.cards",
    icon: Printer,
  },
  {
    labelKey: "layout.navigation.employees",
    path: "/admin/employees",
    permission: "employees.view",
    icon: BriefcaseBusiness,
  },
  {
    labelKey: "layout.navigation.resources",
    path: "/admin/resources",
    permission: "resources.manage",
    icon: MapPinned,
  },
  {
    labelKey: "layout.navigation.menu",
    path: "/admin/menu",
    permission: "menu.manage",
    icon: Utensils,
  },
  {
    labelKey: "layout.navigation.roles",
    path: "/admin/roles",
    permission: "roles.manage",
    icon: Shield,
  },
  {
    labelKey: "layout.navigation.auditLog",
    path: "/admin/audit-log",
    permission: "audit.view",
    icon: ClipboardList,
  },
  {
    labelKey: "layout.navigation.loyalty",
    path: "/admin/loyalty",
    permission: ["loyalty.view", "loyalty.manage"],
    icon: Award,
  },
  {
    labelKey: "layout.navigation.redemptions",
    path: "/admin/loyalty/redemptions",
    permission: ["loyalty.redemptions.fulfill", "loyalty.manage"],
    icon: Gift,
  },
  {
    labelKey: "layout.navigation.settings",
    path: "/admin/settings",
    permission: "settings.manage",
    icon: Settings,
  },
];

export function AppLayout() {
  const { i18n, t } = useTranslation();
  const { permissions, profile, session, signOut } = useAuth();
  const { settings } = useBranding();
  const alertOverview = useAlertOverview(
    Boolean(session && profile?.status === "active" && permissions.includes("alerts.view")),
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readStoredSidebarCollapsed,
  );
  const resizeStartX = useRef<number | null>(null);

  const isRtl = i18n.dir() === "rtl";
  const isApplicationRoute =
    location.pathname === "/dashboard" ||
    location.pathname === "/scan" ||
    location.pathname === "/timers" ||
    location.pathname.startsWith("/bookings") ||
    location.pathname.startsWith("/quality") ||
    location.pathname.startsWith("/incidents") ||
    location.pathname.startsWith("/alerts") ||
    location.pathname === "/inventory" ||
    location.pathname === "/pos" ||
    location.pathname.startsWith("/shifts") ||
    location.pathname.startsWith("/orders") ||
    location.pathname.startsWith("/admin/") ||
    location.pathname === "/customers" ||
    location.pathname.startsWith("/customers/");
  const showApplicationLayout =
    isApplicationRoute && profile?.status === "active" && Boolean(session);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // The sidebar remains usable when browser storage is unavailable.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // The sidebar remains usable when browser storage is unavailable.
    }
  }, [sidebarCollapsed]);

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    setSignOutError(false);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  };

  const visibleNavigation = navigationItems.filter((item) =>
    !item.permission
      ? true
      : Array.isArray(item.permission)
      ? item.permission.some((permission) => permissions.includes(permission))
      : permissions.includes(item.permission),
  ).filter((item) =>
    item.sidebar !== false &&
    !(item.path === "/orders/new" && permissions.includes("orders.view")),
  );
  const userName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim()
    : "";

  if (!showApplicationLayout) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
          <Link
            aria-label={settings.workspaceName}
            to="/"
          >
            <BrandingIdentity />
          </Link>
          <div className="flex items-center gap-2">
            {session && profile?.status === "active" && (
              <NotificationBell userId={session.user.id} />
            )}
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">
          {session && profile?.status === "active" && permissions.includes("alerts.view") && (
            <AlertCriticalBanner
              error={alertOverview.error}
              onRetry={() => void alertOverview.retry()}
              overview={alertOverview.overview}
              sticky={false}
            />
          )}
          <Outlet />
        </main>
        <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400 sm:px-8">
          <span>{t("brand.portal")}</span>
          <span>{settings.workspaceName}</span>
          <span>
            {t("layout.poweredBy")}{" "}
            <a
              className="font-semibold text-brand underline-offset-2 hover:underline"
              href="https://www.instagram.com/nexlaytech?"
              rel="noopener noreferrer"
              target="_blank"
            >
              Nexlay
            </a>
          </span>
        </footer>
      </div>
    );
  }

  const sidebar = (
    <aside
      className={`relative flex h-full w-full min-w-0 flex-col border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:border-e ${
        sidebarCollapsed ? "md:items-center" : ""
      }`}
    >
      <div
        className={`flex h-16 w-full shrink-0 items-center border-b border-slate-200 dark:border-slate-800 ${
          sidebarCollapsed
            ? "justify-between px-2 md:justify-center md:px-0"
            : "justify-between px-5"
        }`}
      >
        <Link
          aria-label={settings.workspaceName}
          to="/dashboard"
          title={settings.workspaceName}
        >
          <BrandingIdentity
            className={
              sidebarCollapsed
                ? "md:[&>span:last-child]:hidden"
                : ""
            }
            compact
          />
        </Link>
        <div
          className={`flex items-center gap-1 ${
            sidebarCollapsed ? "md:gap-0" : ""
          }`}
        >
          <button
            aria-label={t(
              sidebarCollapsed
                ? "layout.expandNavigation"
                : "layout.collapseNavigation",
            )}
            aria-pressed={sidebarCollapsed}
            className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand dark:text-slate-300 dark:hover:bg-slate-800 md:inline-flex md:size-8"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={t(
              sidebarCollapsed
                ? "layout.expandNavigation"
                : "layout.collapseNavigation",
            )}
            type="button"
          >
            {isRtl ? (
              sidebarCollapsed ? (
                <ChevronLeft aria-hidden="true" size={18} />
              ) : (
                <ChevronRight aria-hidden="true" size={18} />
              )
            ) : sidebarCollapsed ? (
              <ChevronRight aria-hidden="true" size={18} />
            ) : (
              <ChevronLeft aria-hidden="true" size={18} />
            )}
          </button>
          <button
            aria-label={t("layout.closeNavigation")}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>
      </div>

      <nav
        aria-label={t("layout.navigation.label")}
        className={`min-h-0 w-full flex-1 space-y-1 overflow-y-auto py-4 ${
          sidebarCollapsed ? "px-4 md:px-2" : "px-4"
        }`}
      >
        {visibleNavigation.map(({ labelKey, path, icon: Icon }) => (
            <NavLink
              key={path}
              aria-label={t(labelKey)}
              className={({ isActive }) =>
                `group relative flex min-h-11 items-center rounded-xl py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                  sidebarCollapsed
                    ? "gap-3 px-3 md:justify-center md:gap-0 md:px-2"
                    : "gap-3 px-3"
                } ${
                  isActive
                    ? "bg-emerald-50 text-emerald-800 shadow-sm dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`
              }
              onClick={() => setMobileSidebarOpen(false)}
              end={path === "/customers"}
              to={path}
              title={sidebarCollapsed ? t(labelKey) : undefined}
            >
              <Icon
                aria-hidden="true"
                className="transition-transform duration-200 group-hover:scale-110"
                size={18}
              />
              {path === "/alerts" && (alertOverview.overview?.active_count ?? 0) > 0 && (
                <span className="absolute end-1 top-0 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white">
                  {(alertOverview.overview?.active_count ?? 0) > 99
                    ? "99+"
                    : alertOverview.overview?.active_count}
                </span>
              )}
              <span
                className={`truncate md:overflow-hidden md:whitespace-nowrap md:transition-[max-width,opacity] md:duration-300 ${
                  sidebarCollapsed
                    ? "md:max-w-0 md:opacity-0"
                    : "md:max-w-48 md:opacity-100"
                }`}
              >
                {t(labelKey)}
              </span>
            </NavLink>
          ))}
      </nav>

      <div
        className={`w-full shrink-0 border-t border-slate-200 dark:border-slate-800 ${
          sidebarCollapsed ? "p-3" : "p-4"
        }`}
      >
        {sidebarCollapsed && (
          <div
            aria-label={userName || session?.user.email}
            className="mx-auto hidden size-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 md:flex"
            role="img"
            title={`${userName || session?.user.email}${profile?.role?.name ? ` · ${profile.role.name}` : ""}`}
          >
            {(userName || session?.user.email || "?").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className={sidebarCollapsed ? "md:hidden" : ""}>
          <p className="truncate text-sm font-semibold text-ink dark:text-white">
            {userName || session?.user.email}
          </p>
          {profile?.role?.name && (
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {profile.role.name}
            </p>
          )}
        </div>
      </div>
      <div
        aria-label={t("layout.resizeNavigation")}
        aria-orientation="vertical"
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuenow={sidebarWidth}
        className="absolute inset-y-0 -end-1 z-10 hidden w-2 cursor-col-resize touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand md:block"
        onKeyDown={(event) => {
          let nextWidth: number | null = null;
          if (event.key === "ArrowRight") nextWidth = sidebarWidth + (isRtl ? -10 : 10);
          if (event.key === "ArrowLeft") nextWidth = sidebarWidth + (isRtl ? 10 : -10);
          if (event.key === "Home") nextWidth = SIDEBAR_MIN_WIDTH;
          if (event.key === "End") nextWidth = SIDEBAR_MAX_WIDTH;
          if (nextWidth !== null) {
            event.preventDefault();
            setSidebarWidth(
              Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, nextWidth)),
            );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeStartX.current = event.clientX;
        }}
        onPointerMove={(event) => {
          if (resizeStartX.current === null) return;
          const delta = event.clientX - resizeStartX.current;
          resizeStartX.current = event.clientX;
          setSidebarWidth((width) =>
            Math.min(
              SIDEBAR_MAX_WIDTH,
              Math.max(SIDEBAR_MIN_WIDTH, width + delta * (isRtl ? -1 : 1)),
            ),
          );
        }}
        onPointerUp={() => {
          resizeStartX.current = null;
        }}
        onPointerCancel={() => {
          resizeStartX.current = null;
        }}
        role="separator"
        tabIndex={0}
        title={t("layout.resizeNavigation")}
      />
    </aside>
  );

  return (
    <div
      className={`min-h-screen w-full overflow-x-hidden md:flex ${
        isRtl ? "md:flex-row-reverse" : "md:flex-row"
      }`}
    >
      <div
        className="sticky top-0 hidden h-screen shrink-0 transition-[width] duration-300 ease-in-out motion-reduce:transition-none md:block print:hidden"
        style={{
          width: sidebarCollapsed
            ? SIDEBAR_COLLAPSED_WIDTH
            : sidebarWidth,
        }}
      >
        {sidebar}
      </div>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden">
          <button
            aria-label={t("layout.closeNavigation")}
            className="absolute inset-0 bg-slate-950/50"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
          />
          <div
            className={`absolute inset-y-0 w-[min(85vw,320px)] ${
              isRtl ? "right-0" : "left-0"
            }`}
          >
            <div className="h-full [&_aside]:items-stretch [&_nav_span]:inline">
              {sidebar}
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label={
                mobileSidebarOpen
                  ? t("layout.closeNavigation")
                  : t("layout.openNavigation")
              }
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 md:hidden"
              onClick={() => setMobileSidebarOpen((open) => !open)}
              type="button"
            >
              {mobileSidebarOpen ? (
                <X aria-hidden="true" size={19} />
              ) : (
                <Menu aria-hidden="true" size={19} />
              )}
            </button>
            <span className="truncate text-sm font-semibold text-ink dark:text-white md:hidden">
              {settings.workspaceName}
            </span>
            <span className="hidden text-sm text-slate-500 dark:text-slate-400 md:inline">
              {t("layout.workspace")}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ShiftIndicator />
            {session && <NotificationBell userId={session.user.id} />}
            <LanguageSwitcher />
            <ThemeToggle />
            <div className="hidden min-w-0 text-end lg:block">
              <p className="max-w-44 truncate text-sm font-medium text-ink dark:text-white">
                {userName || session?.user.email}
              </p>
              {profile?.role?.name && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {profile.role.name}
                </p>
              )}
            </div>
            <button
              className="inline-flex size-10 items-center justify-center gap-2 rounded-lg border border-slate-300 text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 lg:w-auto lg:px-3"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              type="button"
            >
              <LogOut aria-hidden="true" size={17} />
              <span className="hidden text-sm font-medium lg:inline">
                {signingOut
                  ? t("layout.signingOut")
                  : t("layout.signOut")}
              </span>
            </button>
          </div>
        </header>

        {signOutError && (
          <p
            className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 sm:mx-6"
            role="alert"
          >
            {t("auth.errors.signOutFailed")}
          </p>
        )}

        {session && profile?.status === "active" && permissions.includes("alerts.view") && (
          <AlertCriticalBanner
            error={alertOverview.error}
            onRetry={() => void alertOverview.retry()}
            overview={alertOverview.overview}
          />
        )}

        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 text-xs font-medium tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:px-8 print:hidden">
          <span>{t("brand.portal")}</span>
          <span>{settings.workspaceName}</span>
          <span>
            {t("layout.poweredBy")}{" "}
            <a
              className="font-semibold text-brand underline-offset-2 hover:underline"
              href="https://www.instagram.com/nexlaytech?"
              rel="noopener noreferrer"
              target="_blank"
            >
              Nexlay
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
