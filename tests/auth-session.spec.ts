import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test("cached access opens a new scan tab and sign-out propagates across tabs", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and staging E2E_EMAIL/E2E_PASSWORD to run auth tests",
  );

  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);

  const secondTab = await page.context().newPage();
  await secondTab.goto("/scan");
  await expect(secondTab.locator("#manual-code")).toBeVisible();
  await expect(secondTab.getByText("Checking your session", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  await expect(secondTab).toHaveURL(/\/login$/, { timeout: 10_000 });
});
