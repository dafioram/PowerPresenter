// Object URLs for a presentation's assets, plus downscaled editing previews
// for very large images (spec §8.4: over 16 MP or 4,096 px on the long edge).
import { listAssetRecords, putAsset, getAsset } from '../../storage/repo.js';

export class AssetCache {
  constructor(presentationId, onChange) {
    this.presentationId = presentationId;
    this.onChange = onChange || (() => {});
    this.blobs = new Map();
    this.urls = new Map();
    this.previews = new Map();
    this.pending = new Set();
  }

  async loadAll(doc) {
    const recs = await listAssetRecords(this.presentationId);
    for (const r of recs) {
      if (r.pending) continue;
      this.blobs.set(r.asset_id, r.blob);
    }
    for (const a of doc.assets || []) this.ensurePreview(a);
  }

  has(id) {
    return this.blobs.has(id);
  }

  blob(id) {
    return this.blobs.get(id) || null;
  }

  async blobAsync(id) {
    if (this.blobs.has(id)) return this.blobs.get(id);
    const b = await getAsset(this.presentationId, id);
    if (b) this.blobs.set(id, b);
    return b;
  }

  url(id) {
    if (!id) return null;
    let u = this.urls.get(id);
    if (!u) {
      const b = this.blobs.get(id);
      if (!b) return null;
      u = URL.createObjectURL(b);
      this.urls.set(id, u);
    }
    return u;
  }

  // Editing preview if one exists, otherwise the original.
  editUrl(id) {
    return this.previews.get(id) || this.url(id);
  }

  ensurePreview(record) {
    if (!record || record.kind !== 'image' || this.previews.has(record.id) || this.pending.has(record.id)) return;
    const big = record.width * record.height > 16_000_000 || Math.max(record.width, record.height) > 4096;
    if (!big || typeof createImageBitmap === 'undefined') return;
    const blob = this.blobs.get(record.id);
    if (!blob) return;
    this.pending.add(record.id);
    const scale = 4096 / Math.max(record.width, record.height);
    createImageBitmap(blob, { resizeWidth: Math.round(record.width * scale), resizeHeight: Math.round(record.height * scale), resizeQuality: 'high' })
      .then((bmp) => {
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
        return new Promise((resolve) => c.toBlob(resolve, record.media_type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
      })
      .then((b) => {
        if (b) {
          this.previews.set(record.id, URL.createObjectURL(b));
          this.onChange();
        }
      })
      .catch(() => undefined)
      .finally(() => this.pending.delete(record.id));
  }

  async add(record, blob) {
    await putAsset(this.presentationId, record.id, blob);
    this.blobs.set(record.id, blob);
    this.ensurePreview(record);
  }

  // Frees memory for assets no longer live.
  forget(ids) {
    for (const id of ids) {
      const u = this.urls.get(id);
      if (u) URL.revokeObjectURL(u);
      const p = this.previews.get(id);
      if (p) URL.revokeObjectURL(p);
      this.urls.delete(id);
      this.previews.delete(id);
      this.blobs.delete(id);
    }
  }

  dispose() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    for (const u of this.previews.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.previews.clear();
    this.blobs.clear();
  }
}
