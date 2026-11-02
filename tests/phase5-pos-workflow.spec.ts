import { expect, test } from "@playwright/test";

test("Reception creates an order, Barista serves it, and Reception issues a receipt", async ({
  browser,
}) => {
  const receptionEmail = process.env.E2E_RECEPTION_EMAIL;
  const receptionPassword = process.env.E2E_RECEPTION_PASSWORD;
  const baristaEmail = process.env.E2E_BARISTA_EMAIL;
  const baristaPassword = process.env.E2E_BARISTA_PASSWORD;
  const customerCode = process.env.E2E_CUSTOMER_CODE;
  const productName = process.env.E2E_PRODUCT_NAME_EN;
  test.skip(
    process.env.E2E_ENV !== "staging" ||
      !receptionEmail ||
      !receptionPassword ||
      !baristaEmail ||
      !baristaPassword ||
      !customerCode ||
      !productName,
    "Set staging Reception/Barista credentials and fake E2E customer/product fixtures",
  );

  const receptionContext = await browser.newContext();
  const receptionPage = await receptionContext.newPage();
  await receptionPage.goto("/login");
  await receptionPage.locator("#login-email").fill(receptionEmail!);
  await receptionPage.locator("#login-password").fill(receptionPassword!);
  await receptionPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(receptionPage).not.toHaveURL(/\/login$/);
  await receptionPage.goto("/pos");

  const openShiftButton = receptionPage.getByRole("button", { name: "Open shift", exact: true });
  if (await openShiftButton.count()) {
    await receptionPage.getByLabel("Opening cash").fill("0");
    const scheduledShift = receptionPage.getByLabel("Choose today's assigned shift");
    if (await scheduledShift.count()) {
      const options = await scheduledShift.locator("option").count();
      if (options > 1) await scheduledShift.selectOption({ index: 1 });
    }
    await openShiftButton.click();
    await expect(receptionPage.getByText("Shift is open", { exact: true })).toBeVisible();
  }

  const visitSelect = receptionPage.getByLabel("Customer currently inside");
  const visitOption = visitSelect.locator("option").filter({ hasText: customerCode! });
  await expect(visitOption).toHaveCount(1);
  await visitSelect.selectOption((await visitOption.getAttribute("value"))!);

  const productSelect = receptionPage.getByLabel("Product");
  const productOption = productSelect.locator("option", { hasText: productName! });
  await expect(productOption).toHaveCount(1);
  await productSelect.selectOption((await productOption.getAttribute("value"))!);
  await receptionPage.getByRole("button", { name: "Calculate server total", exact: true }).click();

  const order = receptionPage.locator("article")
    .filter({ hasText: customerCode! })
    .filter({ hasText: productName! })
    .first();
  await expect(order).toBeVisible();
  await expect(receptionPage.getByRole("status")).toContainText("Order");

  const baristaContext = await browser.newContext();
  const baristaPage = await baristaContext.newPage();
  await baristaPage.goto("/login");
  await baristaPage.locator("#login-email").fill(baristaEmail!);
  await baristaPage.locator("#login-password").fill(baristaPassword!);
  await baristaPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(baristaPage).not.toHaveURL(/\/login$/);
  await baristaPage.goto("/pos");

  const baristaOrder = baristaPage.locator("article")
    .filter({ hasText: customerCode! })
    .filter({ hasText: productName! })
    .first();
  await expect(baristaOrder).toBeVisible();
  await baristaOrder.getByRole("button", { name: "Start preparing", exact: true }).click();
  await baristaOrder.getByRole("button", { name: "Mark ready", exact: true }).click();
  await baristaOrder.getByRole("button", { name: "Mark served", exact: true }).click();
  await expect(baristaOrder.getByText("Served", { exact: true })).toBeVisible();
  await baristaContext.close();

  await receptionPage.reload();
  const servedOrder = receptionPage.locator("article")
    .filter({ hasText: customerCode! })
    .filter({ hasText: productName! })
    .first();
  await expect(servedOrder.getByRole("button", {
    name: "Take payment and issue receipt",
    exact: true,
  })).toBeVisible();
  await servedOrder.getByRole("button", {
    name: "Take payment and issue receipt",
    exact: true,
  }).click();
  await expect(receptionPage.getByRole("status")).toContainText("Receipt");

  await receptionPage.goto("/receipts");
  await expect(
    receptionPage.getByRole("row").filter({ hasText: customerCode! }).first(),
  ).toBeVisible();

  await receptionContext.close();
});
