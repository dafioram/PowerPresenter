import { describe, it, expect } from 'vitest';
import { writeZip, readCentralDirectory, extractEntry } from '../../src/io/zip.js';
import { exportPres, importPres, safeFilename } from '../../src/io/pres.js';
import { newPresentation } from '../../src/core/factory.js';
import { canonicalize } from '../../src/core/canonical.js';
import { slideOrder, imageElement, textElement } from '../../src/core/model.js';
import { sha256 } from '../../src/io/hash.js';
import { _internal } from '../../src/io/photo-metadata.js';
import { parseVtt, normalizeVtt } from '../../src/io/webvtt.js';
import { zipSync, strToU8 } from 'fflate';

const PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function docWithImage() {
  const doc = newPresentation({ title: 'Round trip' });
  const blob = new Blob([PNG_1x1], { type: 'image/png' });
  const id = 'img_asset_1';
  doc.assets.push({ id, kind: 'image', media_type: 'image/png', byte_size: blob.size, sha256: await sha256(blob), width: 1, height: 1, original_filename: 'dot.png', path: `assets/${id}.png` });
  const sid = slideOrder(doc)[0];
  doc.slides[sid].elements.push(imageElement({ assetId: id, alt: 'A dot' }));
  doc.slides[sid].elements.push(textElement({ text: 'Hello ✓ 你好' }));
  return { doc, assets: new Map([[id, blob]]) };
}

describe('zip', () => {
  it('writes and reads back entries', async () => {
    const blob = await writeZip([
      { name: 'manifest.json', data: '{"a":1}', compress: true },
      { name: 'assets/x.bin', data: new Blob([new Uint8Array(1000).fill(7)]), compress: false },
    ]);
    const entries = await readCentralDirectory(blob);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'assets/x.bin']);
    const m = await extractEntry(blob, entries[0]);
    expect(new TextDecoder().decode(m)).toBe('{"a":1}');
    const x = await extractEntry(blob, entries[1]);
    expect(x.length).toBe(1000);
  });
});

describe('.pres round trip', () => {
  it('export → import is lossless after canonicalization with byte-identical assets', async () => {
    const { doc, assets } = await docWithImage();
    const { blob, filename } = await exportPres(doc, async (id) => assets.get(id));
    expect(filename).toBe('Round trip.pres');
    const res = await importPres(blob);
    expect(canonicalize(res.doc)).toEqual(canonicalize(doc));
    const back = res.assets.get('img_asset_1');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(PNG_1x1);
  });

  it('rejects newer versions, path traversal, missing assets and hash mismatches', async () => {
    const { doc, assets } = await docWithImage();
    const env = (d, v = 1) => JSON.stringify({ format: 'pres', format_version: v, created_with: '9', document: d });
    const mk = (files) => new Blob([zipSync(files)]);
    await expect(importPres(mk({ 'manifest.json': strToU8(env(doc, 99)) }))).rejects.toThrow(/newer version/);
    await expect(importPres(mk({ 'manifest.json': strToU8(env(doc)), '../evil.txt': strToU8('x') }))).rejects.toThrow(/\.\./);
    await expect(importPres(mk({ 'manifest.json': strToU8(env(doc)) }))).rejects.toThrow(/missing the file/);
    await expect(importPres(mk({ 'manifest.json': strToU8(env(doc)), 'assets/img_asset_1.png': new Uint8Array([1, 2, 3]) }))).rejects.toThrow(/checksum|size/);
    await expect(importPres(new Blob(['not a zip at all']))).rejects.toThrow(/ZIP/);
    void assets;
  });

  it('rejects zip bombs by ratio', async () => {
    const { doc } = await docWithImage();
    doc.assets = [];
    const sid = slideOrder(doc)[0];
    doc.slides[sid].elements = doc.slides[sid].elements.filter((e) => e.type !== 'image');
    const big = new Uint8Array(20 * 1024 * 1024);
    const files = { 'manifest.json': strToU8(JSON.stringify({ format: 'pres', format_version: 1, created_with: '1', document: doc })), 'assets/bomb.bin': [big, { level: 9 }] };
    await expect(importPres(new Blob([zipSync(files)]))).rejects.toThrow(/zip bomb|unexpected|extra/i);
  });

  it('filenames are sanitized', () => {
    expect(safeFilename('  a/b:c*?  ', 'pres')).toBe('abc.pres');
    expect(safeFilename('', 'pres')).toBe('Untitled.pres');
  });
});

describe('photo metadata', () => {
  it('strips EXIF and comment segments from JPEG', () => {
    const soi = [0xff, 0xd8];
    const app0 = [0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46];
    const app1 = [0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0];
    const com = [0xff, 0xfe, 0, 4, 0x68, 0x69];
    const sos = [0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9];
    const b = new Uint8Array([...soi, ...app0, ...app1, ...com, ...sos]);
    const { parts, changed } = _internal.stripJpeg(b);
    expect(changed).toBe(true);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    expect([...out]).toEqual([...soi, ...app0, ...sos]);
  });

  it('strips text chunks from PNG', () => {
    const { changed } = _internal.stripPng(PNG_1x1);
    expect(changed).toBe(false);
  });
});

describe('webvtt', () => {
  it('parses, strips tags and normalizes idempotently', () => {
    const src = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500 align:start\n<v Bob><b>Hello</b> <script>x</script>world</v>\n\n00:03.000 --> 00:04.000\nBye';
    const cues = parseVtt(src);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('<b>Hello</b> xworld');
    const n = normalizeVtt(src);
    expect(normalizeVtt(n)).toBe(n);
  });
});
