import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test("bulk resource creation reports created and skipped items", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and staging E2E_EMAIL/E2E_PASSWORD to run resource tests",
  );

  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);

  await page.goto("/admin/resources");
  await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
  const prefix = `E2E Seat ${Date.now()}`;
  const prefixField = page.getByLabel("Name prefix");
  await prefixField.fill(prefix);
  await page.getByLabel("Number to create").fill("10");
  await page.getByLabel("Capacity").last().fill("1");
  await page.getByRole("button", { name: "Bulk create", exact: true }).click();
  await expect(
    page.getByText("Bulk creation complete: 10 created, 0 skipped."),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText(prefix + " 1", { exact: true })).toBeVisible();
  await expect(page.getByText(prefix + " 10", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: prefix }),
  ).toHaveCount(10);

  await prefixField.fill(prefix);
  await page.getByRole("button", { name: "Bulk create", exact: true }).click();
  await expect(
    page.getByText("Bulk creation complete: 0 created, 10 skipped."),
  ).toBeVisible();
});
