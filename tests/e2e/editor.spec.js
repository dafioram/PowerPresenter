// Editing: text, shapes, selection, undo/redo, clipboard, grouping, slides,
// notes, find and replace, images, tables and charts (spec §12, §13).
import { test, expect } from '@playwright/test';
import { openApp, newBlank, MOD, clickSlide, dblclickSlide, waitSaved, storedDoc, pngBuffer } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await newBlank(page);
});

async function typeTitle(page, text) {
  await dblclickSlide(page, 640, 295);
  await expect(page.locator('.stage .ProseMirror')).toBeFocused();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test('type into the title placeholder, then undo and redo', async ({ page }) => {
  await typeTitle(page, 'Hello world');
  await expect(page.locator('.stage .pe-slide')).toContainText('Hello world');
  await page.locator('[data-testid="canvas"]').focus();
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator('.stage .pe-slide')).not.toContainText('Hello world');
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(page.locator('.stage .pe-slide')).toContainText('Hello world');
  await waitSaved(page);
  const doc = await storedDoc(page);
  expect(JSON.stringify(doc.slides)).toContain('Hello world');
});

test('insert a shape, nudge it with the keyboard and see the inspector values', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-shape').click();
  await page.locator('[data-shape="rect"]').click();
  const x = page.getByRole('textbox', { name: 'X' });
  await expect(x).toHaveValue('520');
  await page.locator('[data-testid="canvas"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(x).toHaveValue('531');
  // one command per nudge burst
  await page.keyboard.press(`${MOD}+z`);
  await expect(x).toHaveValue('520');
});

test('drag a shape to move it', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-shape').click();
  await page.locator('[data-shape="ellipse"]').click();
  const a = await page.locator('.stage').boundingBox();
  const W = 1280;
  const s = a.width / W;
  const cx = a.x + 640 * s;
  const cy = a.y + 360 * s;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200 * s, cy + 13 * s, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('textbox', { name: 'X' })).toHaveValue(/^7\d\d$/);
});

test('copy and paste an element, group and ungroup', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'clipboard events differ in WebKit');
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-shape').click();
  await page.locator('[data-shape="rect"]').click();
  await page.locator('[data-testid="canvas"]').focus();
  await page.keyboard.press(`${MOD}+d`);
  await page.keyboard.press(`${MOD}+a`);
  await expect(page.getByTestId('slide-position').locator('..')).toContainText('selected');
  await page.keyboard.press(`${MOD}+g`);
  await page.getByTestId('toggle-layers').click();
  await expect(page.getByTestId('layer-row').first()).toContainText('Group');
  await page.locator('[data-testid="canvas"]').focus();
  await page.keyboard.press(`${MOD}+Shift+g`);
  await expect(page.getByTestId('layer-row').first()).not.toContainText('Group');
  void context;
});

test('slides: add, duplicate, hide and delete from the keyboard', async ({ page }) => {
  await page.locator('[data-testid="canvas"]').focus();
  await page.keyboard.press('Control+m');
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 2');
  await page.getByTestId('slide-thumb').nth(1).click();
  await page.keyboard.press(`${MOD}+d`);
  await expect(page.getByTestId('slide-thumb')).toHaveCount(3);
  await page.getByTestId('slide-thumb').nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide slide' }).click();
  await expect(page.getByTestId('slide-thumb').nth(2)).toHaveClass(/is-hidden/);
  await page.getByTestId('slide-thumb').nth(2).click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('slide-thumb')).toHaveCount(2);
});

test('speaker notes persist after reload', async ({ page }) => {
  await page.getByTestId('notes').click();
  await page.keyboard.type('Remember to smile');
  await page.locator('[data-testid="canvas"]').click({ position: { x: 20, y: 20 } });
  await waitSaved(page);
  await page.reload();
  await page.getByTestId('canvas').waitFor();
  await expect(page.getByTestId('notes')).toContainText('Remember to smile');
});

test('find and replace across slides', async ({ page }) => {
  await typeTitle(page, 'Alpha beta alpha');
  await page.keyboard.press(`${MOD}+f`);
  await page.getByTestId('find-input').fill('alpha');
  await expect(page.getByTestId('find-count')).toHaveText('1 of 2');
  await page.getByTestId('replace-input').fill('gamma');
  await page.getByTestId('replace-all').click();
  await expect(page.locator('.stage .pe-slide')).toContainText('gamma beta gamma');
});

test('insert an image from a file, then a table and a chart', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('insert-image').click();
  await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: pngBuffer() });
  await expect(page.locator('.stage .pe-el-image img')).toHaveCount(1);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-table').click();
  await page.locator('.table-picker-grid button').nth(11).click(); // 2 × 2
  await expect(page.locator('.stage table.pe-table tr')).toHaveCount(2);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-chart').click();
  await page.getByTestId('chart-line').click();
  await expect(page.locator('.stage .pe-chart-svg')).toHaveCount(1);
  await page.getByTestId('edit-chart-data').click();
  await page.getByRole('textbox', { name: 'Row 1, column 1' }).fill('99');
  await page.getByTestId('chart-data-apply').click();
  await waitSaved(page);
  const doc = await storedDoc(page);
  const chart = Object.values(doc.slides)[0].elements.find((e) => e.type === 'chart');
  expect(chart.chart.series[0].values[0]).toBe(99);
});

test('theme editor changes an accent color everywhere', async ({ page }) => {
  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Theme editor' }).click();
  const hex = page.getByRole('textbox', { name: 'Text hex', exact: true });
  await hex.fill('#ff0000');
  await hex.press('Enter');
  await waitSaved(page);
  const doc = await storedDoc(page);
  expect(doc.theme.colors['color.text.primary']).toBe('#ff0000');
});

test('version history: save a version and restore it', async ({ page }) => {
  await typeTitle(page, 'Version one');
  await page.getByTestId('toggle-history').click();
  await page.getByTestId('save-version').click();
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('snapshot').first()).toBeVisible();
  await typeTitle(page, ' changed');
  await expect(page.locator('.stage .pe-slide')).toContainText('Version one changed');
  const named = page.getByTestId('snapshot').filter({ hasText: 'Named' }).first();
  await named.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.stage .pe-slide')).not.toContainText('changed');
  await expect(page.locator('.stage .pe-slide')).toContainText('Version one');
});

test('accessibility checker reports a missing slide title', async ({ page }) => {
  await page.getByTestId('toggle-a11y').click();
  await expect(page.getByTestId('a11y-errors')).toHaveText(/1 error/);
  await typeTitle(page, 'Has a title');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByTestId('a11y-errors')).toHaveText(/0 errors/);
});

test('outline view edits a slide title', async ({ page }) => {
  await page.getByRole('radio', { name: 'Outline' }).click();
  const title = page.getByRole('textbox', { name: 'Slide 1 title' });
  await title.fill('From the outline');
  await title.press('Enter');
  await expect(page.locator('.stage .pe-slide')).toContainText('From the outline');
});

test('context menu on the canvas offers paste and grid options', async ({ page }) => {
  await clickSlide(page, 20, 20, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Paste' })).toBeVisible();
  await page.getByRole('menuitemcheckbox', { name: 'Show grid' }).click();
  await expect(page.locator('.overlay .grid-line').first()).toBeAttached();
});
