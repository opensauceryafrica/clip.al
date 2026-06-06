import { expect, test } from '@playwright/test';

test('landing page renders hero + shorten box', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Short links\. Real analytics\./i }),
  ).toBeVisible();
  await expect(page.getByPlaceholder('paste a long link')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('sign-in page asks for an email', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: /send code/i })).toBeVisible();
});
