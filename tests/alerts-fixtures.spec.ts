import { expect, test, type Page } from "@playwright/test";

async function openSeededAlertCenter(page: Page) {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(
    process.env.E2E_ENV !== "staging" ||
      process.env.E2E_ALERT_FIXTURES !== "seeded" ||
      !email ||
      !password,
    "Set up fake alert fixtures on staging and set E2E_ALERT_FIXTURES=seeded.",
  );
  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.locator("#language-switcher").selectOption("en");
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alert Center", exact: true })).toBeVisible();
}

test("Review low alerts in the alert center", async ({ page }) => {
  await openSeededAlertCenter(page);
  await expect(page.getByRole("listitem").filter({ hasText: "Low" }).first()).toBeVisible();
});

test("Review active critical alerts", async ({ page }) => {
  await openSeededAlertCenter(page);
  await expect(page.getByRole("listitem").filter({ hasText: "Critical" }).first()).toBeVisible();
});

test("Review snoozed high alerts", async ({ page }) => {
  await openSeededAlertCenter(page);
  await page.getByRole("tab", { name: "Snoozed", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "High" }).filter({ hasText: "Snoozed" }).first(),
  ).toBeVisible();
});
