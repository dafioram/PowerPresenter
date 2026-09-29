// Editing session for one presentation: the cross-tab lock, autosave and
// automatic snapshots (spec §9.2, §9.3, §9.5).
import { saveDocument, addSnapshot, getMeta, patchMeta } from './repo.js';
import { isQuotaError } from './db.js';

export const CHANNEL_NAME = 'presentation-editor';
const HANDOVER_TIMEOUT = 3000;
const SNAPSHOT_INTERVAL = 10 * 60 * 1000;

let channel = null;
const channelListeners = new Set();
export function getChannel() {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => {
      for (const fn of channelListeners) fn(e.data);
    };
  }
  return channel;
}
export function onChannel(fn) {
  getChannel();
  channelListeners.add(fn);
  return () => channelListeners.delete(fn);
}
export function broadcast(msg) {
  getChannel()?.postMessage(msg);
}

const TAB_ID = Math.random().toString(36).slice(2);

export class EditorSession {
  constructor(presentationId, { getDoc, onStatus, onReadOnly, onLockLost, onReloadRequired }) {
    this.id = presentationId;
    this.getDoc = getDoc;
    this.onStatus = onStatus || (() => {});
    this.onReadOnly = onReadOnly || (() => {});
    this.onLockLost = onLockLost || (() => {});
    this.onReloadRequired = onReloadRequired || (() => {});
    this.readOnly = true;
    this.dirty = false;
    this.lastSavedDoc = null;
    this.saving = false;
    this.debounceTimer = null;
    this.firstDirtyAt = 0;
    this.status = { state: 'saved' };
    this.releaseLock = null;
    this.lockAbort = null;
    this.activeEditingMs = 0;
    this.lastActivity = 0;
    this.changedSinceSnapshot = false;
    this.snapshotTimer = null;
    this.disposed = false;
    this.unsubscribe = onChannel((m) => this.onMessage(m));
    this.onVisibility = () => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    this.onPageHide = () => this.flush();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
  }

  setStatus(status) {
    this.status = status;
    this.onStatus(status);
  }

  // Tries to become the editing tab. Returns true when editing is allowed.
  async acquire({ steal = false } = {}) {
    if (!navigator.locks) {
      this.readOnly = false;
      this.onReadOnly(false);
      return true;
    }
    const name = `presentation:${this.id}`;
    const granted = await new Promise((resolve) => {
      const abort = new AbortController();
      this.lockAbort = abort;
      const opts = steal ? { steal: true } : { ifAvailable: true };
      navigator.locks
        .request(name, opts, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise((release) => {
            this.releaseLock = release;
          });
        })
        .catch((e) => {
          // The lock was stolen by another tab (spec §9.3).
          if (e && e.name === 'AbortError') this.handleLockLost();
          resolve(false);
        });
    });
    this.readOnly = !granted;
    this.onReadOnly(this.readOnly);
    if (granted) this.startSnapshotTimer();
    return granted;
  }

  async handleLockLost() {
    if (this.readOnly || this.disposed) return;
    this.readOnly = true;
    this.releaseLock = null;
    clearTimeout(this.debounceTimer);
    this.stopSnapshotTimer();
    if (this.dirty) {
      try {
        await addSnapshot(this.id, this.getDoc(), { reason: 'Unsaved changes from another tab', name: 'Unsaved changes from another tab', automatic: false });
      } catch {
        /* nothing more we can do */
      }
      this.dirty = false;
    }
    this.onReadOnly(true);
    this.onLockLost();
  }

  // "Edit here": ask the current editor to hand over, then take the lock,
  // stealing it after 3 seconds if the other tab doesn't answer.
  async requestEdit() {
    broadcast({ type: 'handover-request', id: this.id, from: TAB_ID });
    const start = Date.now();
    while (Date.now() - start < HANDOVER_TIMEOUT) {
      await new Promise((r) => setTimeout(r, 150));
      if (await this.acquire()) return true;
    }
    return this.acquire({ steal: true });
  }

  async onMessage(m) {
    if (!m || m.id !== this.id) {
      if (m?.type === 'app-updated') this.onReloadRequired();
      return;
    }
    if (m.type === 'handover-request' && m.from !== TAB_ID && !this.readOnly) {
      await this.flush();
      this.readOnly = true;
      this.stopSnapshotTimer();
      const rel = this.releaseLock;
      this.releaseLock = null;
      rel?.();
      this.onReadOnly(true);
      this.onLockLost();
      broadcast({ type: 'handover-done', id: this.id });
    }
  }

  // Called after every command.
  markDirty() {
    if (this.readOnly) return;
    const now = Date.now();
    if (!this.dirty) this.firstDirtyAt = now;
    this.dirty = true;
    this.changedSinceSnapshot = true;
    if (this.lastActivity && now - this.lastActivity < 60000) this.activeEditingMs += now - this.lastActivity;
    this.lastActivity = now;
    this.setStatus({ state: 'dirty' });
    clearTimeout(this.debounceTimer);
    const sinceFirst = now - this.firstDirtyAt;
    const wait = sinceFirst >= 5000 ? 0 : Math.min(1000, 5000 - sinceFirst);
    this.debounceTimer = setTimeout(() => this.flush(), wait);
  }

  async flush() {
    if (this.readOnly || !this.dirty) return true;
    if (this.saving) {
      this.pendingFlush = true;
      return this.savingPromise;
    }
    clearTimeout(this.debounceTimer);
    this.saving = true;
    this.setStatus({ state: 'saving' });
    const doc = this.getDoc();
    this.dirty = false;
    this.savingPromise = (async () => {
      try {
        await saveDocument(doc);
        this.lastSavedDoc = doc;
        this.retryDelay = 0;
        this.setStatus(this.dirty ? { state: 'dirty' } : { state: 'saved', at: Date.now() });
        broadcast({ type: 'doc-saved', id: this.id });
        return true;
      } catch (e) {
        this.dirty = true;
        const reason = isQuotaError(e) ? 'storage is full' : e?.message || 'unknown error';
        this.setStatus({ state: 'error', reason, quota: isQuotaError(e) });
        this.retryDelay = Math.min(60000, (this.retryDelay || 2000) * 2);
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.flush(), this.retryDelay);
        return false;
      } finally {
        this.saving = false;
        if (this.pendingFlush) {
          this.pendingFlush = false;
          if (this.dirty) setTimeout(() => this.flush(), 0);
        }
      }
    })();
    return this.savingPromise;
  }

  startSnapshotTimer() {
    this.stopSnapshotTimer();
    this.snapshotTimer = setInterval(() => this.maybeSnapshot(), 30000);
  }

  stopSnapshotTimer() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  async maybeSnapshot() {
    if (this.readOnly || !this.changedSinceSnapshot) return;
    if (this.activeEditingMs < SNAPSHOT_INTERVAL) return;
    this.activeEditingMs = 0;
    this.changedSinceSnapshot = false;
    await this.snapshot('Autosave (10 minutes of editing)');
  }

  async snapshot(reason, { name = null } = {}) {
    try {
      await this.flush();
      await addSnapshot(this.id, this.getDoc(), { reason, name, automatic: !name });
      return true;
    } catch {
      return false;
    }
  }

  // Snapshot on open if the presentation changed since the last snapshot.
  async snapshotOnOpen() {
    const m = await getMeta(this.id);
    if (!m) return;
    if (!m.last_snapshot_at || m.updated_at > m.last_snapshot_at) {
      await addSnapshot(this.id, this.getDoc(), { reason: 'Opened', automatic: true });
    }
  }

  async markBackedUp() {
    await patchMeta(this.id, { last_backup_at: new Date().toISOString() });
  }

  async dispose() {
    await this.flush();
    this.disposed = true;
    this.stopSnapshotTimer();
    clearTimeout(this.debounceTimer);
    this.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    const rel = this.releaseLock;
    this.releaseLock = null;
    rel?.();
  }
}

export function isEditingElsewhere(id) {
  if (!navigator.locks?.query) return Promise.resolve(false);
  return navigator.locks.query().then((s) => s.held.some((l) => l.name === `presentation:${id}`));
}

// Workspace actions that change a presentation need its lock (spec §9.3).
export async function withPresentationLock(id, fn) {
  if (!navigator.locks) return fn();
  return navigator.locks.request(`presentation:${id}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('This presentation is open for editing in another tab.');
    return fn();
  });
}
