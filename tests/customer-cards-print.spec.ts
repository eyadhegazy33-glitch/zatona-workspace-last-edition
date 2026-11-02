import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test("prints twelve selected customer cards on twelve sheets", async ({ page }) => {
  test.skip(
    process.env.E2E_ENV !== "staging" || !email || !password,
    "Set E2E_ENV=staging and staging E2E_EMAIL/E2E_PASSWORD to run print tests",
  );

  await page.goto("/login");
  await page.locator("#login-email").fill(email!);
  await page.locator("#login-password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);

  await page.goto("/customers/cards/print");
  await expect(page.locator("[aria-busy]")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const rows = page.getByTestId("customer-card-selection-row");
  if ((await rows.count()) < 12) {
    test.skip(true, "The test account needs at least 12 active customer cards");
  }
  for (let index = 0; index < 12; index += 1) {
    await rows.nth(index).locator('input[type="checkbox"]').check();
  }

  const printedCards = page.locator(
    ".customer-print-pages .customer-card-front",
  );
  await expect(printedCards).toHaveCount(12, { timeout: 30_000 });

  await page.emulateMedia({ media: "print" });
  const sheets = page.locator(".customer-print-sheet");
  await expect(sheets).toHaveCount(12);
  for (const sheet of await sheets.all()) {
    await expect(sheet.locator(".customer-card-front")).toHaveCount(1);
  }
  await expect(page.locator("body > #customer-print-pages")).toBeVisible();
  await expect(printedCards.first().locator(".customer-card-name")).toBeVisible();
  await expect(printedCards.first().locator(".customer-card-content")).toBeVisible();
  await expect(printedCards.first().locator(".customer-card-qr img")).toHaveJSProperty(
    "naturalWidth",
    256,
  );

  const dimensions = await printedCards.first().evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(dimensions.width).toBeCloseTo((85.6 / 25.4) * 96, 0);
  expect(dimensions.height).toBeCloseTo((54 / 25.4) * 96, 0);
});
