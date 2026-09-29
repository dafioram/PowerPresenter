// Exports (spec §15): .pres round trip, HTML, images, PowerPoint and the PDF
// print view.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openApp, openGettingStarted } from './helpers.js';

async function exportTo(page, target, testInfo, setup = null) {
  await page.getByTestId('export-button').click();
  await page.getByTestId(`export-target-${target}`).click();
  if (setup) await setup(page);
  await expect(page.getByTestId('export-run')).toBeEnabled({ timeout: 20_000 });
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('export-run').click();
  const d = await download;
  const path = testInfo.outputPath(d.suggestedFilename());
  await d.saveAs(path);
  return { path, name: d.suggestedFilename() };
}

function zipNames(buf) {
  // central directory scan
  const names = [];
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  for (let k = 0; k < count; k++) {
    const n = buf.readUInt16LE(p + 28);
    const e = buf.readUInt16LE(p + 30);
    const c = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + n).toString('utf8'));
    p += 46 + n + e + c;
  }
  return names;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openGettingStarted(page);
});

test('.pres export imports back as a copy', async ({ page }, testInfo) => {
  const { path, name } = await exportTo(page, 'pres', testInfo);
  expect(name).toMatch(/\.pres$/);
  const names = zipNames(readFileSync(path));
  expect(names).toContain('manifest.json');
  await page.getByTestId('back-to-workspace').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(path);
  // same ID already exists → conflict dialog
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Import as copy' }).click();
  // a single imported file opens in the editor
  await page.getByTestId('canvas').waitFor();
  await page.getByTestId('back-to-workspace').click();
  await expect(page.getByTestId('pres-card')).toHaveCount(2, { timeout: 15_000 });
});

test('standalone HTML presents offline from disk', async ({ page, browser }, testInfo) => {
  const { path } = await exportTo(page, 'html', testInfo);
  const html = readFileSync(path, 'utf8');
  expect(html).toContain('Content-Security-Policy');
  expect(html).not.toMatch(/<script[^>]*src=/);
  const ctx = await browser.newContext({ offline: true });
  const p2 = await ctx.newPage();
  const errors = [];
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(`file://${path}`);
  await expect(p2.locator('.pv-counter')).toHaveText('1 / 9');
  await p2.keyboard.press('ArrowRight');
  await expect(p2.locator('.pv-counter')).toHaveText('2 / 9');
  await expect(p2.locator('.pe-slide').last()).toContainText('What you can do');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('images export as a ZIP of PNGs', async ({ page }, testInfo) => {
  const { path } = await exportTo(page, 'images', testInfo);
  const names = zipNames(readFileSync(path));
  expect(names.length).toBe(9);
  expect(names[0]).toMatch(/^01-.*\.png$/);
  const buf = readFileSync(path);
  expect(buf.includes(Buffer.from('IHDR'))).toBeTruthy();
});

test('PowerPoint export contains slides, a chart and notes', async ({ page }, testInfo) => {
  const { path, name } = await exportTo(page, 'pptx', testInfo);
  expect(name).toMatch(/\.pptx$/);
  const names = zipNames(readFileSync(path));
  expect(names).toContain('[Content_Types].xml');
  expect(names).toContain('ppt/presentation.xml');
  expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length).toBe(9);
  expect(names).toContain('ppt/charts/chart1.xml');
  expect(names.some((n) => n.startsWith('ppt/embeddings/'))).toBeTruthy();
  expect(names.some((n) => n.startsWith('ppt/notesSlides/'))).toBeTruthy();
});

test('PDF print view has one page per visible slide', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only');
  await page.evaluate(() => {
    window.__PE_KEEP_PRINT_VIEW__ = true;
    window.print = () => { window.__printed = true; };
  });
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-target-pdf').click();
  await expect(page.getByTestId('export-run')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('export-run').click();
  await expect.poll(() => page.evaluate(() => window.__printed === true)).toBe(true);
  await expect(page.locator('.pe-print-root .pe-print-page')).toHaveCount(9);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  writeFileSync(testInfo.outputPath('deck.pdf'), pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBe(9);
});

