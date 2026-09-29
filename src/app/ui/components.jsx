// Shared UI components: buttons, menus, dialogs, toasts, fields.
import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from './icons.jsx';

// ---------- tiny global stores ----------

function createSignal(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set: (v) => {
      value = typeof v === 'function' ? v(value) : v;
      for (const s of subs) s(value);
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useSignal(sig) {
  const [, force] = useState(0);
  useEffect(() => sig.subscribe(() => force((n) => n + 1)), [sig]);
  return sig.get();
}

// ---------- buttons ----------

export function Button({ variant = 'secondary', icon, children, class: cls = '', type = 'button', ...rest }) {
  return (
    <button type={type} class={`btn btn-${variant} ${cls}`} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, pressed, class: cls = '', size = 18, shortcut, ...rest }) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button type="button" class={`icon-btn ${pressed ? 'is-pressed' : ''} ${cls}`} aria-label={label} title={title} aria-pressed={pressed === undefined ? undefined : !!pressed} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

// ---------- popover / menu ----------

export function usePopover() {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  return { open, setOpen, anchor, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

export function Popover({ anchor, open, onClose, children, placement = 'bottom-start', class: cls = '', label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!open || !anchor?.current || !ref.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    let left = placement.endsWith('end') ? a.right - p.width : a.left;
    let top = placement.startsWith('top') ? a.top - p.height - 4 : a.bottom + 4;
    if (placement.startsWith('right')) {
      left = a.right + 4;
      top = a.top;
    }
    left = Math.max(8, Math.min(window.innerWidth - p.width - 8, left));
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - p.height - 4);
    setPos({ left, top });
  }, [open, anchor, placement]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.current?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        anchor?.current?.focus?.();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} class={`popover ${cls}`} style={{ left: `${pos.left}px`, top: `${pos.top}px` }} role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

// items: [{ label, icon, onSelect, disabled, shortcut, checked, separator, danger, hint }]
export function MenuList({ items, onClose, label }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])')?.focus();
  }, []);
  const onKey = (e) => {
    const all = [...ref.current.querySelectorAll('[role^="menuitem"]:not([disabled])')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[(i + 1) % all.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      all[all.length - 1]?.focus();
    } else if (e.key === 'Tab') onClose?.();
  };
  return (
    <div class="menu" role="menu" aria-label={label} ref={ref} onKeyDown={onKey}>
      {items.filter(Boolean).map((it, i) =>
        it.separator ? (
          <div key={`s${i}`} class="menu-sep" role="separator" />
        ) : it.heading ? (
          <div key={`h${i}`} class="menu-heading">{it.heading}</div>
        ) : (
          <button
            key={it.label}
            type="button"
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked === undefined ? undefined : !!it.checked}
            class={`menu-item ${it.danger ? 'is-danger' : ''}`}
            disabled={it.disabled}
            title={it.hint}
            onClick={() => {
              onClose?.();
              it.onSelect?.();
            }}
          >
            <span class="menu-icon">{it.checked !== undefined ? it.checked && <Icon name="check" size={15} /> : it.icon && <Icon name={it.icon} size={15} />}</span>
            <span class="menu-label">{it.label}</span>
            {it.shortcut && <span class="menu-shortcut">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function MenuButton({ label, icon, items, children, class: cls = '', buttonClass = '', placement, title, variant }) {
  const pop = usePopover();
  const itemList = typeof items === 'function' ? (pop.open ? items() : []) : items;
  return (
    <span class={`menu-wrap ${cls}`}>
      <button
        ref={pop.anchor}
        type="button"
        class={variant ? `btn btn-${variant} ${buttonClass}` : children ? `btn btn-ghost ${buttonClass}` : `icon-btn ${buttonClass}`}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-label={label}
        title={title || label}
        onClick={pop.toggle}
      >
        {icon && <Icon name={icon} size={children ? 16 : 18} />}
        {children && <span>{children}</span>}
        {children && <Icon name="chevronDown" size={14} />}
      </button>
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} placement={placement} label={label}>
        <MenuList items={itemList} onClose={pop.close} label={label} />
      </Popover>
    </span>
  );
}

// ---------- context menu ----------

export const contextMenuSignal = createSignal(null);

export function openContextMenu(x, y, items) {
  contextMenuSignal.set({ x, y, items });
}

export function ContextMenuHost() {
  const cm = useSignal(contextMenuSignal);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!cm || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(cm.x, window.innerWidth - r.width - 8), top: Math.min(cm.y, window.innerHeight - r.height - 8) });
  }, [cm]);
  useEffect(() => {
    if (!cm) return undefined;
    const close = (e) => {
      if (ref.current?.contains(e.target)) return;
      contextMenuSignal.set(null);
    };
    const key = (e) => {
      if (e.key === 'Escape') contextMenuSignal.set(null);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [cm]);
  if (!cm) return null;
  return (
    <div ref={ref} class="popover context-menu" style={{ left: `${pos?.left ?? cm.x}px`, top: `${pos?.top ?? cm.y}px` }}>
      <MenuList items={cm.items} onClose={() => contextMenuSignal.set(null)} label="Context menu" />
    </div>
  );
}

// ---------- dialogs ----------

export const dialogsSignal = createSignal([]);
let dialogSeq = 0;

// Opens a dialog component; resolves with the value passed to close().
export function openDialog(Component, props = {}) {
  return new Promise((resolve) => {
    const id = ++dialogSeq;
    const returnFocus = document.activeElement;
    const close = (value) => {
      dialogsSignal.set((list) => list.filter((d) => d.id !== id));
      resolve(value);
      setTimeout(() => returnFocus?.focus?.(), 0);
    };
    dialogsSignal.set((list) => [...list, { id, Component, props: { ...props, close } }]);
  });
}

export function DialogHost() {
  const list = useSignal(dialogsSignal);
  return (
    <>
      {list.map((d) => (
        <d.Component key={d.id} {...d.props} />
      ))}
    </>
  );
}

export function Dialog({ title, onClose, children, footer, width = 520, class: cls = '', dismissable = true, description }) {
  const ref = useRef(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    const el = ref.current;
    const first = el?.querySelector('[data-autofocus]') || el?.querySelector('input, select, textarea, button:not(.dialog-close), [tabindex="0"]');
    if (first) first.focus();
    else el?.focus();
  }, []);
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      onClose?.();
    }
    if (e.key === 'Tab') {
      const f = [...ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  return createPortal(
    <div class="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose?.(); }}>
      <div ref={ref} class={`dialog ${cls}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ width: `min(${width}px, calc(100vw - 32px))` }} onKeyDown={onKey}>
        <div class="dialog-head">
          <h2 id={titleId}>{title}</h2>
          {dismissable && <IconButton icon="close" label="Close" class="dialog-close" onClick={() => onClose?.()} />}
        </div>
        {description && <p class="dialog-desc">{description}</p>}
        <div class="dialog-body">{children}</div>
        {footer && <div class="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function ConfirmDialog({ close, title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger, extra }) {
  return (
    <Dialog
      title={title}
      onClose={() => close(false)}
      width={460}
      footer={
        <>
          <Button onClick={() => close(false)}>{cancelLabel}</Button>
          {extra && <Button onClick={() => close(extra.value)}>{extra.label}</Button>}
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p class="pre-line">{message}</p>
    </Dialog>
  );
}

export function confirmDialog(opts) {
  return openDialog(ConfirmDialog, opts);
}

function PromptDialog({ close, title, label, value = '', confirmLabel = 'OK', placeholder, maxLength = 200, multiline }) {
  const [v, setV] = useState(value);
  const submit = (e) => {
    e?.preventDefault();
    close(v);
  };
  return (
    <Dialog
      title={title}
      onClose={() => close(null)}
      width={440}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{confirmLabel}</Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <label class="field">
          <span class="field-label">{label}</span>
          {multiline ? (
            <textarea class="input" rows={4} value={v} maxLength={maxLength} placeholder={placeholder} onInput={(e) => setV(e.currentTarget.value)} data-autofocus />
          ) : (
            <input class="input" value={v} maxLength={maxLength} placeholder={placeholder} onInput={(e) => setV(e.currentTarget.value)} data-autofocus onFocus={(e) => e.currentTarget.select()} />
          )}
        </label>
      </form>
    </Dialog>
  );
}

export function promptDialog(opts) {
  return openDialog(PromptDialog, opts);
}

// ---------- toasts ----------

export const toastsSignal = createSignal([]);
let toastSeq = 0;

export function toast(message, { kind = 'info', action = null, duration = 5000, id } = {}) {
  const tid = id || `t${++toastSeq}`;
  toastsSignal.set((list) => [...list.filter((t) => t.id !== tid), { id: tid, message, kind, action }]);
  if (duration) setTimeout(() => dismissToast(tid), duration);
  return tid;
}

export function dismissToast(id) {
  toastsSignal.set((list) => list.filter((t) => t.id !== id));
}

export function ToastHost() {
  const list = useSignal(toastsSignal);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
          <span class="toast-msg">{t.message}</span>
          {t.action && (
            <button type="button" class="toast-action" onClick={() => { dismissToast(t.id); t.action.onClick(); }}>
              {t.action.label}
            </button>
          )}
          <button type="button" class="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- live region ----------

export const announceSignal = createSignal('');
export function announce(msg) {
  announceSignal.set('');
  setTimeout(() => announceSignal.set(msg), 30);
}
export function LiveRegion() {
  const msg = useSignal(announceSignal);
  return (
    <div class="sr-only" aria-live="polite" aria-atomic="true">
      {msg}
    </div>
  );
}

// ---------- fields ----------

export function Field({ label, children, hint, class: cls = '' }) {
  return (
    <label class={`field ${cls}`}>
      <span class="field-label">{label}</span>
      {children}
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

export function NumberField({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, precision = 2, disabled, class: cls = '', compact, title }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const shown = value === null || value === undefined || Number.isNaN(value) ? '' : String(Math.round(value * 10 ** precision) / 10 ** precision);
  const commit = (raw) => {
    const n = Number(String(raw).replace(',', '.'));
    if (raw === '' || !Number.isFinite(n)) {
      setText(shown);
      return;
    }
    const c = Math.min(max, Math.max(min, n));
    if (c !== value) onChange(c);
  };
  return (
    <label class={`field num-field ${compact ? 'is-compact' : ''} ${cls}`} title={title}>
      {label && <span class="field-label">{label}</span>}
      <span class="num-wrap">
        <input
          class="input"
          inputMode="decimal"
          disabled={disabled}
          value={focused ? text : shown}
          onFocus={(e) => {
            setText(shown);
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={(e) => {
            setFocused(false);
            commit(e.currentTarget.value);
          }}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit(e.currentTarget.value);
              e.currentTarget.select();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const base = Number(e.currentTarget.value) || value || 0;
              const n = Math.min(max, Math.max(min, base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
              setText(String(Math.round(n * 10 ** precision) / 10 ** precision));
              onChange(n);
            } else if (e.key === 'Escape') {
              setText(shown);
              e.currentTarget.blur();
            }
          }}
        />
        {unit && <span class="num-unit">{unit}</span>}
      </span>
    </label>
  );
}

export function Select({ label, value, options, onChange, disabled, class: cls = '', compact }) {
  return (
    <label class={`field ${compact ? 'is-compact' : ''} ${cls}`}>
      {label && <span class="field-label">{label}</span>}
      <select class="input select" value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) =>
          o.group ? (
            <optgroup label={o.group} key={o.group}>
              {o.options.map((x) => (
                <option value={x.value} key={x.value}>{x.label}</option>
              ))}
            </optgroup>
          ) : (
            <option value={o.value} key={o.value} disabled={o.disabled}>{o.label}</option>
          ),
        )}
      </select>
    </label>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }) {
  return (
    <label class="check">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({ label, value, onCommit, placeholder, maxLength = 200, disabled, multiline, rows = 3, class: cls = '' }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    if ((value ?? '') !== v) onCommit(v);
  };
  return (
    <label class={`field ${cls}`}>
      {label && <span class="field-label">{label}</span>}
      {multiline ? (
        <textarea class="input" rows={rows} value={v} maxLength={maxLength} placeholder={placeholder} disabled={disabled} onInput={(e) => setV(e.currentTarget.value)} onBlur={commit} />
      ) : (
        <input class="input" value={v} maxLength={maxLength} placeholder={placeholder} disabled={disabled} onInput={(e) => setV(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      )}
    </label>
  );
}

export function Segmented({ label, value, options, onChange, class: cls = '' }) {
  return (
    <div class={`segmented ${cls}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          class={value === o.value ? 'is-on' : ''}
          title={o.label}
          aria-label={o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} size={16} /> : o.short || o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.value === value);
    if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
    if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
  };
  return (
    <div class="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} class={t.value === value ? 'is-on' : ''} onClick={() => onChange(t.value)}>
          {t.icon && <Icon name={t.icon} size={15} />}
          <span>{t.label}</span>
          {t.badge ? <span class="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

export { createSignal };
