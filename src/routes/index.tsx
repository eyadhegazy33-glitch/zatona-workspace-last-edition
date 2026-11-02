import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PendingApprovalPage } from "../pages/PendingApprovalPage";
import { RegisterPage } from "../pages/RegisterPage";
import { ResetPasswordPage } from "../pages/ResetPasswordPage";
import { CustomerLoyaltyLoginPage } from "../pages/CustomerLoyaltyLoginPage";
import { CustomerLoyaltyPortalPage } from "../pages/CustomerLoyaltyPortalPage";
import { CustomerPortalLayout } from "../layouts/CustomerPortalLayout";
import {
  NotAllowedPage,
  PendingApprovalRoute,
  PermissionRoute,
  ProtectedRoute,
} from "./ProtectedRoute";

export const router = createBrowserRouter([
  {
    element: <CustomerPortalLayout />,
    children: [
      { path: "/customer", element: <Navigate replace to="/customer/login" /> },
      { path: "/customer/login", element: <CustomerLoyaltyLoginPage /> },
      { path: "/customer/portal", element: <CustomerLoyaltyPortalPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <Navigate replace to="/login" /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/register", element: <RegisterPage /> },
      {
        element: <PendingApprovalRoute />,
        children: [
          { path: "/pending-approval", element: <PendingApprovalPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          { path: "/not-allowed", element: <NotAllowedPage /> },
          {
            path: "/dashboard",
            lazy: async () => {
              const { DashboardPage } = await import("../pages/DashboardPage");
              return { Component: DashboardPage };
            },
          },
          {
            element: <PermissionRoute permission="scanner.use" />,
            children: [{
              path: "/scan",
              lazy: async () => {
                const { ScanPage } = await import("../pages/ScanPage");
                return { Component: ScanPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="timers.view" />,
            children: [{
              path: "/timers",
              lazy: async () => {
                const { TimersPage } = await import("../pages/TimersPage");
                return { Component: TimersPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="inventory.view" />,
            children: [{
              path: "/inventory",
              lazy: async () => {
                const { InventoryPage } = await import("../pages/InventoryPage");
                return { Component: InventoryPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="alerts.view" />,
            children: [
              {
                path: "/alerts",
                lazy: async () => {
                  const { AlertsPage } = await import("../pages/AlertsPage");
                  return { Component: AlertsPage };
                },
              },
              {
                path: "/alerts/shift-session/:sessionId",
                lazy: async () => {
                  const { AlertShiftSessionPage } = await import("../pages/AlertShiftSessionPage");
                  return { Component: AlertShiftSessionPage };
                },
              },
              {
                path: "/alerts/scan-log/:alertId",
                lazy: async () => {
                  const { AlertScanLogPage } = await import("../pages/AlertScanLogPage");
                  return { Component: AlertScanLogPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission={["incidents.view", "incidents.report", "incidents.manage"]} />,
            children: [{
              path: "/incidents",
              lazy: async () => {
                const { IncidentsPage } = await import("../pages/IncidentsPage");
                return { Component: IncidentsPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="incidents.report" />,
            children: [{
              path: "/incidents/new",
              lazy: async () => {
                const { IncidentNewPage } = await import("../pages/IncidentNewPage");
                return { Component: IncidentNewPage };
              },
            }],
          },
          {
            element: <ProtectedRoute />,
            children: [{
              path: "/incidents/:incidentId",
              lazy: async () => {
                const { IncidentDetailPage } = await import("../pages/IncidentDetailPage");
                return { Component: IncidentDetailPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="bookings.view" />,
            children: [
              {
                path: "/bookings",
                lazy: async () => {
                  const { BookingsPage } = await import("../pages/BookingsPage");
                  return { Component: BookingsPage };
                },
              },
              {
                path: "/bookings/list",
                lazy: async () => {
                  const { BookingsPage } = await import("../pages/BookingsPage");
                  return { Component: BookingsPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="qc.fill" />,
            children: [{
              path: "/quality",
              lazy: async () => {
                const { QualityPage } = await import("../pages/QualityPage");
                return { Component: QualityPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="qc.manage" />,
            children: [{
              path: "/quality/checklists",
              lazy: async () => {
                const { QualityChecklistsPage } = await import("../pages/QualityChecklistsPage");
                return { Component: QualityChecklistsPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission={["qc.review", "qc.fill"]} />,
            children: [{
              path: "/quality/history",
              lazy: async () => {
                const { QualityHistoryPage } = await import("../pages/QualityHistoryPage");
                return { Component: QualityHistoryPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="qc.review" />,
            children: [{
              path: "/quality/reports",
              lazy: async () => {
                const { QualityReportsPage } = await import("../pages/QualityReportsPage");
                return { Component: QualityReportsPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="shifts.manage" />,
            children: [{
              path: "/shifts",
              lazy: async () => {
                const { ShiftsPage } = await import("../pages/ShiftsPage");
                return { Component: ShiftsPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="shifts.use" />,
            children: [
              {
                path: "/shifts/current",
                lazy: async () => {
                  const { CurrentShiftPage } = await import("../pages/CurrentShiftPage");
                  return { Component: CurrentShiftPage };
                },
              },
              {
                path: "/shifts/my",
                lazy: async () => {
                  const { MyShiftsPage } = await import("../pages/MyShiftsPage");
                  return { Component: MyShiftsPage };
                },
              },
            ],
          },
          {
            element: (
              <PermissionRoute
                permission={["receipts.view", "receipts.view_own"]}
              />
            ),
            children: [{
              path: "/receipts",
              lazy: async () => {
                const { ReceiptsPage } = await import("../pages/ReceiptsPage");
                return { Component: ReceiptsPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="payments.collect" />,
            children: [
              {
                path: "/checkout/:customerId",
                lazy: async () => {
                  const { CustomerCheckoutPage } = await import(
                    "../pages/CustomerCheckoutPage"
                  );
                  return { Component: CustomerCheckoutPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="orders.view" />,
            children: [
              {
                path: "/pos",
                lazy: async () => {
                  const { PointOfSalePage } = await import("../pages/PointOfSalePage");
                  return { Component: PointOfSalePage };
                },
              },
              {
                path: "/orders/board",
                lazy: async () => {
                  const { OrderBoardPage } = await import("../pages/OrderBoardPage");
                  return { Component: OrderBoardPage };
                },
              },
              {
                path: "/orders",
                lazy: async () => {
                  const { OrdersPage } = await import("../pages/OrdersPage");
                  return { Component: OrdersPage };
                },
              },
            ],
          },
          {
            element: (
              <PermissionRoute permission={["orders.create", "orders.manage"]} />
            ),
            children: [{
              path: "/orders/new",
              lazy: async () => {
                const { NewOrderPage } = await import("../pages/NewOrderPage");
                return { Component: NewOrderPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="customers.import" />,
            children: [
              {
                path: "/customers/import",
                lazy: async () => {
                  const { CustomerImportPage } = await import(
                    "../pages/CustomerImportPage"
                  );
                  return { Component: CustomerImportPage };
                },
              },
              {
                path: "/customers/import/history",
                lazy: async () => {
                  const { CustomerImportHistoryPage } = await import(
                    "../pages/CustomerImportHistoryPage"
                  );
                  return { Component: CustomerImportHistoryPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="customers.cards" />,
            children: [
              {
                path: "/customers/cards/print",
                lazy: async () => {
                  const { CustomerCardsPrintPage } = await import(
                    "../pages/CustomerCardsPrintPage"
                  );
                  return { Component: CustomerCardsPrintPage };
                },
              },
            ],
          },
          {
            element: (
              <PermissionRoute permission="customers.view" />
            ),
            children: [
              {
                path: "/customers",
                lazy: async () => {
                  const { CustomersPage } = await import("../pages/CustomersPage");
                  return { Component: CustomersPage };
                },
              },
              {
                path: "/customers/:customerId",
                lazy: async () => {
                  const { CustomerProfilePage } = await import(
                    "../pages/CustomerProfilePage"
                  );
                  return { Component: CustomerProfilePage };
                },
              },
            ],
          },
          {
            element: (
              <PermissionRoute permission="customers.create" />
            ),
            children: [
              {
                path: "/customers/new",
                lazy: async () => {
                  const { CustomerFormPage } = await import(
                    "../pages/CustomerFormPage"
                  );
                  return { Component: CustomerFormPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="customers.edit" />,
            children: [
              {
                path: "/customers/:customerId/edit",
                lazy: async () => {
                  const { CustomerFormPage } = await import(
                    "../pages/CustomerFormPage"
                  );
                  return { Component: CustomerFormPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="accounts.approve" />,
            children: [
              {
                path: "/admin/pending-accounts",
                lazy: async () => {
                  const { PendingAccountsPage } = await import(
                    "../pages/PendingAccountsPage"
                  );
                  return { Component: PendingAccountsPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="employees.view" />,
            children: [{
              path: "/admin/employees",
              lazy: async () => {
                const { EmployeesPage } = await import("../pages/EmployeesPage");
                return { Component: EmployeesPage };
              },
            }],
          },
          {
            element: (
              <PermissionRoute
                permission={["menu.manage", "menu.availability"]}
              />
            ),
            children: [{
              path: "/admin/menu",
              lazy: async () => {
                const { AdminMenuPage } = await import("../pages/AdminMenuPage");
                return { Component: AdminMenuPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="resources.manage" />,
            children: [{
              path: "/admin/resources",
              lazy: async () => {
                const { ResourcesPage } = await import("../pages/ResourcesPage");
                return { Component: ResourcesPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="roles.manage" />,
            children: [{
              path: "/admin/roles",
              lazy: async () => {
                const { RolesPage } = await import("../pages/RolesPage");
                return { Component: RolesPage };
              },
            }],
          },
          {
            element: <PermissionRoute permission="settings.manage" />,
            children: [
              {
                path: "/admin/settings",
                lazy: async () => {
                  const { SettingsPage } = await import("../pages/SettingsPage");
                  return { Component: SettingsPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="audit.view" />,
            children: [
              {
                path: "/admin/audit-log",
                lazy: async () => {
                  const { AuditLogPage } = await import("../pages/AuditLogPage");
                  return { Component: AuditLogPage };
                },
              },
            ],
          },
          {
            element: <PermissionRoute permission="loyalty.manage" />,
            children: [
              {
                path: "/admin/loyalty",
                lazy: async () => {
                  const { LoyaltyAdminPage } = await import("../pages/LoyaltyAdminPage");
                  return { Component: LoyaltyAdminPage };
                },
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
