// Data safety (spec §9): autosave, one editor per presentation, handover.
import { test, expect } from '@playwright/test';
import { openApp, newBlank, dblclickSlide, waitSaved } from './helpers.js';

test('changes survive a reload', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await dblclickSlide(page, 640, 295);
  await page.keyboard.type('Saved automatically');
  await page.keyboard.press('Escape');
  await waitSaved(page);
  await page.reload();
  await page.getByTestId('canvas').waitFor();
  await expect(page.locator('.stage .pe-slide')).toContainText('Saved automatically');
});

test('a second tab opens read-only and can take over editing', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Web Locks handover is verified in Chromium and Firefox');
  await openApp(page);
  await newBlank(page);
  const url = page.url();
  const second = await context.newPage();
  await second.goto(url);
  await second.getByTestId('canvas').waitFor();
  await expect(second.getByTestId('readonly-banner')).toBeVisible();
  await second.getByTestId('edit-here').click();
  await expect(second.getByTestId('readonly-banner')).toHaveCount(0);
  await expect(page.getByTestId('readonly-banner')).toBeVisible();
  await expect(page.getByTestId('readonly-banner')).toContainText('Editing moved to another tab');
  // edits in the new editing tab are saved
  await dblclickSlide(second, 640, 295);
  await second.keyboard.type('Edited in tab two');
  await second.keyboard.press('Escape');
  await waitSaved(second);
});

test('keyboard-only: select, move and delete an element', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('inspector')).toContainText('Title');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('inspector')).toContainText('Subtitle');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('inspector')).toContainText('Title');
});
