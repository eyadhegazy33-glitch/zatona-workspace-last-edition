import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test('customer scans and can check in without or with a seat', async ({ page }) => {
  test.skip(
    process.env.E2E_ENV !== 'staging' || !email || !password,
    'Set E2E_ENV=staging and staging E2E_EMAIL/E2E_PASSWORD for this authenticated flow',
  );

  await page.goto('/login');
  await page.locator('#login-email').fill(email!);
  await page.locator('#login-password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);

  const unique = Date.now();
  const resourceName = `E2E Seat ${unique}`;
  await page.goto('/admin/resources');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').nth(0).fill(resourceName);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/customers/new');
  await page.getByText('First name', { exact: true }).locator('..').locator('input').fill(`Scan${unique}`);
  await page.getByText('Last name', { exact: true }).locator('..').locator('input').fill('Customer');
  await page.getByText('Birth date', { exact: true }).locator('..').locator('input').fill('2004-05-22');
  const typeSelect = page.getByText('Student type', { exact: true }).locator('..').locator('select');
  await typeSelect.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page).toHaveURL(/\/customers\/[a-z0-9-]+$/);

  const code = (await page.locator('p.font-mono').first().textContent())?.trim();
  expect(code).toBeTruthy();

  await page.goto('/scan');
  await page.locator('#manual-code').fill(code!);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Entry allowed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText('Check-in completed.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Already inside since/)).toBeVisible();

  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(page.getByText('Check-out completed.', { exact: true })).toBeVisible();

  await page.locator('#manual-code').fill(code!);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText('Resource', { exact: true }).locator('..').locator('select').selectOption({ label: new RegExp(resourceName) });
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByText(/Already inside since/)).toBeVisible();

  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(page.getByText('Check-out completed.', { exact: true })).toBeVisible();
});
