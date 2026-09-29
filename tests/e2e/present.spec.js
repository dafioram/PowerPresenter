// Presentation mode (spec §14): builds, navigation, end screen, exit.
import { test, expect } from '@playwright/test';
import { openApp, openGettingStarted } from './helpers.js';

test('present from the beginning, step through builds and exit', async ({ page }) => {
  await openApp(page);
  await openGettingStarted(page);
  await page.getByTestId('present-button').click();
  const root = page.getByTestId('present-root');
  await expect(root).toBeVisible();
  await expect(root.locator('.pv-counter')).toHaveText('1 / 9');
  await page.keyboard.press('ArrowRight');
  await expect(root.locator('.pv-counter')).toHaveText('2 / 9');
  // slide 2 builds one bullet at a time
  const bullets = root.locator('.pv-stage .pe-slide').last();
  await expect(bullets).toContainText('What you can do');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(root.locator('.pv-counter')).toHaveText('2 / 9');
  await expect(page).toHaveURL(/#slide-2$/);
  await page.keyboard.press('End');
  await expect(root.locator('.pv-counter')).toHaveText('9 / 9');
  await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 9 of 9');
});

test('overview grid and jump by number', async ({ page }) => {
  await openApp(page);
  await openGettingStarted(page);
  await page.getByTestId('present-button').click();
  const root = page.getByTestId('present-root');
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  await expect(root.locator('.pv-counter')).toHaveText('4 / 9');
  await page.keyboard.press('g');
  await expect(root.locator('.pv-overview')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(root).toHaveCount(0);
});
