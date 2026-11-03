import { expect, test, type Page } from "@playwright/test";

async function signInAsAdmin(page: Page) {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and fake staging Admin credentials.",
  );
  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.locator("#language-switcher").selectOption("en");
}

test("Use dashboard export action", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/dashboard");
  const exportButton = page.getByRole("button", { name: "Export to Excel", exact: true });
  await expect(exportButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("zatona_dashboard.xlsx");
  await expect(page.locator('[role="status"]').filter({ hasText: "Dashboard export downloaded." })).toBeVisible();
});

test("Print the dashboard overview", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      (window as Window & { printCallCount?: number }).printCallCount =
        ((window as Window & { printCallCount?: number }).printCallCount ?? 0) + 1;
    };
  });
  await signInAsAdmin(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Print / PDF", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Dashboard print preview" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Revenue", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Print overview / Save as PDF" }).click();
  expect(await page.evaluate(() =>
    (window as Window & { printCallCount?: number }).printCallCount,
  )).toBe(1);
});

test("Export audit log data", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/audit-log");
  const exportButton = page.getByRole("button", { name: "Export CSV", exact: true });
  await expect(exportButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  expect((await downloadPromise).suggestedFilename()).toBe("audit-log.csv");
  await expect(page.locator('[role="status"]').filter({ hasText: "Downloaded" })).toBeVisible();
});

test.describe(
  "Adjust customer points / Record a point adjustment for a customer / Adjust customer points balance / Adjust customer points with a reason",
  () => {
    test("shows the server-confirmed balance before resetting the form", async ({ page }) => {
      test.skip(
        process.env.E2E_ENV !== "staging" || !process.env.E2E_FAKE_CUSTOMER_CODE,
        "Set E2E_ENV=staging and E2E_FAKE_CUSTOMER_CODE for an isolated fake customer.",
      );
      await signInAsAdmin(page);
      await page.goto("/admin/loyalty");
      await page.locator("#adjust-customer").fill(process.env.E2E_FAKE_CUSTOMER_CODE!);
      await page.locator("#adjust-points").fill("1");
      await page.locator("#adjust-reason").fill("Automated staging confirmation test");
      await page.getByRole("button", { name: "Record adjustment", exact: true }).click();
      await expect(page.locator('[role="status"]').filter({
        hasText: "Adjustment of +1 points recorded.",
      })).toBeVisible();
      await expect(page.locator("#adjust-customer")).toHaveValue("");
    });
  },
);

test.describe("Update loyalty earning rate / Configure loyalty earning rate", () => {
  test("shows the server-saved rate after refresh", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/loyalty");
    const rateInput = page.locator("#loyalty-rate");
    await expect(rateInput).toBeVisible();
    const originalRate = await rateInput.inputValue();
    const nextRate = originalRate === "3.5" ? "3.6" : "3.5";
    const rateForm = page.locator("form").filter({ has: rateInput });
    const saveRate = async (rate: string) => {
      await rateInput.fill(rate);
      await rateForm.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Earning rate saved:" })).toBeVisible();
    };

    try {
      await saveRate(nextRate);
      await expect(rateInput).toHaveValue(nextRate);
    } finally {
      if (originalRate && originalRate !== nextRate) await saveRate(originalRate);
    }
  });
});

test("Close personal shift", async ({ page }) => {
  const email = process.env.E2E_RECEPTION_EMAIL;
  const password = process.env.E2E_RECEPTION_PASSWORD;
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and fake staging Reception credentials.",
  );
  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto("/shifts/my");
  await page.getByRole("link", { name: "Current shift", exact: true }).first().click();
  const closeShift = page.getByRole("button", { name: "Close shift", exact: true });
  test.skip(
    !(await closeShift.isVisible()),
    "Set up an open fake Reception shift before testing the close workflow.",
  );
  await closeShift.click();
  await expect(page.getByRole("dialog").getByText("Counted cash", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm close" })).toBeVisible();
});

test("My shifts links to the current-shift workflow", async ({ page }) => {
  const email = process.env.E2E_RECEPTION_EMAIL;
  const password = process.env.E2E_RECEPTION_PASSWORD;
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and fake staging Reception credentials.",
  );
  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto("/shifts/my");
  await page.getByRole("link", { name: "Current shift", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Cash shift", exact: true })).toBeVisible();
});
