import { expect, test, type Page } from "@playwright/test";

type E2ERole = {
  label: string;
  email: string | undefined;
  password: string | undefined;
  allowed: string[];
  denied: string[];
};

const roles: E2ERole[] = [
  {
    label: "admin",
    email: process.env.E2E_ADMIN_EMAIL,
    password: process.env.E2E_ADMIN_PASSWORD,
    allowed: ["/admin/roles", "/admin/audit-log", "/alerts"],
    denied: [],
  },
  {
    label: "manager",
    email: process.env.E2E_MANAGER_EMAIL,
    password: process.env.E2E_MANAGER_PASSWORD,
    allowed: ["/inventory", "/admin/audit-log", "/quality/reports"],
    denied: ["/admin/roles", "/scan"],
  },
  {
    label: "reception",
    email: process.env.E2E_RECEPTION_EMAIL,
    password: process.env.E2E_RECEPTION_PASSWORD,
    allowed: ["/scan", "/orders", "/bookings"],
    denied: ["/inventory", "/alerts"],
  },
  {
    label: "barista",
    email: process.env.E2E_BARISTA_EMAIL,
    password: process.env.E2E_BARISTA_PASSWORD,
    allowed: ["/timers", "/inventory", "/quality"],
    denied: ["/scan", "/customers"],
  },
];

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

for (const role of roles) {
  test(`${role.label} can open permitted pages and is denied forbidden pages`, async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_ENV !== "staging" || !role.email || !role.password,
      `Set E2E_ENV=staging and fake staging credentials for ${role.label}`,
    );
    await signIn(page, role.email!, role.password!);
    if (role.label === "reception" || role.label === "barista") {
      await page.goto("/dashboard");
      await expect(page.getByText("Revenue", { exact: false })).toHaveCount(0);
    }

    for (const route of role.allowed) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    }

    for (const route of role.denied) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/not-allowed$/);
    }
  });
}

test("Arabic RTL and English LTR render at a phone viewport", async ({
  page,
}, testInfo) => {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and fake staging Admin credentials for locale checks",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, email!, password!);
  await page.goto("/dashboard");

  const language = page.locator("#language-switcher");
  await language.selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: testInfo.outputPath("dashboard-ar-phone.png"), fullPage: true });

  await language.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.screenshot({ path: testInfo.outputPath("dashboard-en-phone.png"), fullPage: true });
});

test("fake registration stays pending until an Admin approves it", async ({
  browser,
}) => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  test.skip(
    process.env.E2E_ENV !== "staging" || !adminEmail || !adminPassword,
    "Set E2E_ENV=staging and fake staging Admin credentials for registration checks",
  );

  const suffix = Date.now();
  const email = `phase5-fake-${suffix}@example.invalid`;
  const password = `FakePhase5${suffix}A1`;
  const registrationContext = await browser.newContext();
  const registrationPage = await registrationContext.newPage();
  await registrationPage.goto("/register");
  await registrationPage.locator("#firstName").fill("Fake");
  await registrationPage.locator("#lastName").fill(`Tester${suffix}`);
  await registrationPage.locator("#phoneNumber").fill("+1 202 555 0100");
  await registrationPage.locator("#email").fill(email);
  await registrationPage.locator("#password").fill(password);
  await registrationPage.locator("#confirmPassword").fill(password);
  await registrationPage.locator("#requestedRoleId").selectOption({ label: "Reception" });
  await registrationPage.locator('form[aria-label] button[type="submit"]').click();
  await expect(registrationPage.getByRole("status")).toBeVisible();
  await registrationContext.close();

  const employeeContext = await browser.newContext();
  const employeePage = await employeeContext.newPage();
  await signIn(employeePage, email, password);
  await expect(employeePage).toHaveURL(/\/pending-approval$/);
  await employeePage.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(employeePage).toHaveURL(/\/login$/);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, adminEmail!, adminPassword!);
  await adminPage.goto("/admin/pending-accounts");
  const pendingRow = adminPage.getByRole("row").filter({ hasText: email });
  await expect(pendingRow).toBeVisible();
  await pendingRow.getByRole("button", { name: "Approve", exact: true }).click();
  await adminPage.locator("#approval-role").selectOption({ label: "Reception" });
  await adminPage.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(pendingRow).toHaveCount(0);
  await adminContext.close();

  await signIn(employeePage, email, password);
  await expect(employeePage).toHaveURL(/\/dashboard$/);
  await employeeContext.close();
});
