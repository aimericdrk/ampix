import { expect, test } from '@playwright/test';

test('boots, logs in, and lands on the projects page', async ({ page }) => {
  await page.goto('/');

  // Anonymous visitor is redirected to login by the auth guard.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Log in to MyAmpix' })).toBeVisible();

  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct-horse-9');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('Demo App')).toBeVisible();
});

test('shows inline error for bad credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByText('Invalid email or password')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
