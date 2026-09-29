// Command system with undo and redo (spec §12.3). Every document change is a
// command: an immer recipe applied to the current document. History entries keep
// the structurally shared document before and after, which is what each command
// needs to invert itself, at little memory cost.
import { produce, setAutoFreeze } from 'immer';
import { LIMITS } from './limits.js';

setAutoFreeze(true);

export class ValidationFailure extends Error {
  constructor(label, errors) {
    super(`Command "${label}" produced an invalid document: ${errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    this.errors = errors;
  }
}

export function createStore(initialDoc, { validate = null, historyLimit = LIMITS.historyEntries, coalesceWindow = 1000 } = {}) {
  let doc = initialDoc;
  let past = [];
  let future = [];
  let lastKeyBreak = false;
  const listeners = new Set();

  const emit = (event) => {
    for (const fn of listeners) fn(event);
  };

  return {
    getDoc: () => doc,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // label: history label; recipe: (draft) => void; opts: { coalesce, selection, selectionBefore }
    dispatch(label, recipe, opts = {}) {
      const next = produce(doc, (draft) => {
        recipe(draft);
      });
      if (next === doc) return false;
      if (validate) {
        const r = validate(next);
        if (!r.ok) throw new ValidationFailure(label, r.errors);
      }
      const now = Date.now();
      const last = past[past.length - 1];
      if (opts.coalesce && last && !lastKeyBreak && last.key === opts.coalesce && now - last.time < (opts.window ?? coalesceWindow)) {
        last.after = next;
        last.time = now;
        if (opts.selection !== undefined) last.selAfter = opts.selection;
      } else {
        past.push({ label, before: doc, after: next, key: opts.coalesce || null, time: now, selBefore: opts.selectionBefore, selAfter: opts.selection });
        if (past.length > historyLimit) past = past.slice(past.length - historyLimit);
      }
      lastKeyBreak = false;
      future = [];
      doc = next;
      emit({ type: 'change', label, opts });
      return true;
    },
    // Ends the current coalescing span (selection jump, formatting change).
    breakCoalescing() {
      lastKeyBreak = true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoLabel: () => past[past.length - 1]?.label || null,
    redoLabel: () => future[future.length - 1]?.label || null,
    undo() {
      const e = past.pop();
      if (!e) return null;
      future.push(e);
      doc = e.before;
      lastKeyBreak = true;
      emit({ type: 'undo', entry: e });
      return e;
    },
    redo() {
      const e = future.pop();
      if (!e) return null;
      past.push(e);
      doc = e.after;
      lastKeyBreak = true;
      emit({ type: 'redo', entry: e });
      return e;
    },
    // Replaces the document outside history (load, restore, migration).
    replace(newDoc, { clearHistory = true, label = 'replace' } = {}) {
      doc = newDoc;
      if (clearHistory) {
        past = [];
        future = [];
      }
      emit({ type: 'replace', label });
    },
    clearHistory() {
      past = [];
      future = [];
      emit({ type: 'history' });
    },
    // Documents referenced by history (for asset liveness, spec §8.5).
    historyDocs() {
      const out = [];
      for (const e of past) out.push(e.before, e.after);
      for (const e of future) out.push(e.before, e.after);
      return out;
    },
    historySize: () => ({ past: past.length, future: future.length }),
  };
}
