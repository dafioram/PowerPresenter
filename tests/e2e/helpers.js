// Shared helpers for the end-to-end tests.
import { expect } from '@playwright/test';

export const MOD = 'ControlOrMeta';

// Opens the workspace and dismisses the first-run welcome dialog.
export async function openApp(page) {
  await page.goto('./');
  const welcome = page.getByRole('dialog', { name: 'Welcome to Presentation Editor' });
  try {
    await welcome.waitFor({ timeout: 2500 });
    await welcome.getByRole('button', { name: 'Skip' }).click();
  } catch {
    /* not the first run */
  }
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
}

export async function newBlank(page) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Create blank' }).click();
  await waitForEditor(page);
}

export async function openGettingStarted(page) {
  const btn = page.getByRole('button', { name: 'Open the Getting started deck' });
  await btn.click();
  await waitForEditor(page);
}

export async function waitForEditor(page) {
  await page.getByTestId('canvas').waitFor();
  await page.locator('.stage .pe-slide').first().waitFor();
  await page.waitForTimeout(300);
}

// Converts a point in slide units to page coordinates.
export async function slidePoint(page, x, y) {
  const box = await page.locator('.stage').boundingBox();
  const W = Number(await page.locator('.stage').evaluate((s) => parseFloat(s.style.width)));
  const scale = box.width / W;
  return { x: box.x + x * scale, y: box.y + y * scale, scale };
}

export async function clickSlide(page, x, y, opts = {}) {
  const p = await slidePoint(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}

export async function dblclickSlide(page, x, y) {
  const p = await slidePoint(page, x, y);
  await page.mouse.dblclick(p.x, p.y);
}

export async function waitSaved(page) {
  await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 10_000 });
}

// Reads the current document through the editor's IndexedDB store.
export async function storedDoc(page) {
  return page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('p');
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('presentation-editor');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const store = [...db.objectStoreNames].find((n) => n === 'documents');
    const rec = await new Promise((res, rej) => {
      const t = db.transaction(store, 'readonly').objectStore(store).get(id);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
    db.close();
    return rec?.doc || null;
  });
}

// Creates a small PNG file on the fly (for upload tests).
export function pngBuffer() {
  // 40×30 red PNG
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsMmZfz2IQQYcTfo3056IWCwWi8VisVgsFov/xgu6J36M1viz4gAAAABJRU5ErkJggg==', 'base64');
}
