// Workspace: create, rename, duplicate, trash and restore (spec §11, §9.6).
import { test, expect } from '@playwright/test';
import { openApp, newBlank, openGettingStarted } from './helpers.js';

test('first run shows the welcome dialog and an empty workspace', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('dialog', { name: 'Welcome to Presentation Editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText('No presentations yet.')).toBeVisible();
});

test('create a blank presentation and return to the workspace', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await expect(page).toHaveURL(/\?p=/);
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 1 of 1');
  await page.getByTestId('title-input').fill('Quarterly review');
  await page.getByTestId('title-input').press('Enter');
  await page.getByTestId('back-to-workspace').click();
  await expect(page.getByTestId('pres-card')).toHaveCount(1);
  await expect(page.getByTestId('pres-card')).toContainText('Quarterly review');
});

// Firefox answers navigator.storage.persist() only after the user responds to
// a permission prompt. Creating a presentation must not wait for that answer.
test('creating a presentation does not wait for the persistent-storage prompt', async ({ page }) => {
  await page.addInitScript(() => {
    if (!navigator.storage) return;
    navigator.storage.persisted = () => Promise.resolve(false);
    navigator.storage.persist = () => new Promise(() => {}); // prompt never answered
  });
  await openApp(page);
  await openGettingStarted(page); // built-in template
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 1 of 9');
  await page.getByTestId('back-to-workspace').click();
  await newBlank(page); // blank presentation
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 1 of 1');
});

test('duplicate, trash with undo, and search', async ({ page }) => {
  await openApp(page);
  await openGettingStarted(page);
  await page.getByTestId('back-to-workspace').click();
  await expect(page.getByTestId('pres-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Actions for Getting started' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByTestId('pres-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Actions for Getting started (copy)' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await expect(page.getByTestId('pres-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('pres-card')).toHaveCount(2);
  await page.getByLabel('Search by title').fill('copy');
  await expect(page.getByTestId('pres-card')).toHaveCount(1);
});

test('workspace settings and shortcuts dialogs open', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog')).toContainText('Undo');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings…' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});
