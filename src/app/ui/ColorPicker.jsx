// Theme-aware color picker (spec §12.9): theme colors with tints, recent colors,
// hex input and an eyedropper where the browser has one.
import { useState } from 'preact/hooks';
import { Popover, usePopover, createSignal, useSignal } from './components.jsx';
import { Icon } from './icons.jsx';
import { resolveColor, toCss, isHex } from '../../core/color.js';
import { COLOR_TOKEN_LABELS } from '../../core/theme.js';

const recent = createSignal([]);
const GRID_TOKENS = ['color.background', 'color.text.primary', 'color.surface', 'color.text.secondary', 'color.accent.1', 'color.accent.2', 'color.accent.3', 'color.accent.4', 'color.accent.5', 'color.accent.6'];
const TINTS = [0, 0.8, 0.6, 0.4, -0.25, -0.5];

function describe(value) {
  if (value === undefined || value === null) return 'Automatic';
  if (value === 'none') return 'None';
  if (typeof value === 'string') return value.toUpperCase();
  const base = COLOR_TOKEN_LABELS[value.token] || value.token;
  if (!value.tint) return base;
  return `${base}, ${value.tint > 0 ? 'lighter' : 'darker'} ${Math.round(Math.abs(value.tint) * 100)}%`;
}

function sameColor(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function ColorPicker({ label, value, theme, onChange, allowNone = false, allowAuto = false, compact = false }) {
  const pop = usePopover();
  const rec = useSignal(recent);
  const [hex, setHex] = useState('');
  const css = value === 'none' || value === undefined || value === null ? null : toCss(resolveColor(value, theme));
  const pick = (v) => {
    onChange(v);
    if (v && v !== 'none') recent.set((r) => [v, ...r.filter((x) => !sameColor(x, v))].slice(0, 8));
    pop.close();
  };
  const eyedrop = async () => {
    try {
      const res = await new window.EyeDropper().open();
      if (isHex(res.sRGBHex)) pick(res.sRGBHex.toLowerCase());
    } catch {
      /* cancelled */
    }
  };
  return (
    <span class={`color-field ${compact ? 'is-compact' : ''}`}>
      {label && !compact && <span class="field-label">{label}</span>}
      <button ref={pop.anchor} type="button" class="color-btn" onClick={pop.toggle} aria-haspopup="dialog" aria-expanded={pop.open} aria-label={`${label}: ${describe(value)}`} title={`${label}: ${describe(value)}`}>
        <span class={`swatch ${css ? '' : 'is-empty'}`} style={css ? { background: css } : undefined} />
        {!compact && <span class="color-name">{describe(value)}</span>}
      </button>
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} label={`${label} color`} class="color-pop">
        <div class="color-panel">
          {(allowAuto || allowNone) && (
            <div class="color-row">
              {allowAuto && (
                <button type="button" class={`chip ${value === undefined || value === null ? 'is-on' : ''}`} onClick={() => pick(undefined)}>
                  Automatic
                </button>
              )}
              {allowNone && (
                <button type="button" class={`chip ${value === 'none' ? 'is-on' : ''}`} onClick={() => pick('none')}>
                  None
                </button>
              )}
            </div>
          )}
          <div class="color-section-label">Theme colors</div>
          <div class="theme-grid" role="grid">
            {TINTS.map((tint) => (
              <div class="theme-grid-row" role="row" key={tint}>
                {GRID_TOKENS.map((token) => {
                  const v = tint ? { token, tint } : { token };
                  const c = toCss(resolveColor(v, theme));
                  return (
                    <button
                      key={token}
                      type="button"
                      role="gridcell"
                      class={`swatch-btn ${sameColor(v, value) ? 'is-on' : ''}`}
                      style={{ background: c }}
                      title={describe(v)}
                      aria-label={describe(v)}
                      onClick={() => pick(v)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div class="color-row">
            {['color.link', 'color.highlight', 'color.border'].map((token) => (
              <button key={token} type="button" class={`swatch-btn ${sameColor({ token }, value) ? 'is-on' : ''}`} style={{ background: toCss(resolveColor({ token }, theme)) }} title={describe({ token })} aria-label={describe({ token })} onClick={() => pick({ token })} />
            ))}
          </div>
          {rec.length > 0 && (
            <>
              <div class="color-section-label">Recent</div>
              <div class="color-row">
                {rec.map((v, i) => (
                  <button key={i} type="button" class="swatch-btn" style={{ background: toCss(resolveColor(v, theme)) }} title={describe(v)} aria-label={describe(v)} onClick={() => pick(v)} />
                ))}
              </div>
            </>
          )}
          <form
            class="color-row hex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const h = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
              if (isHex(h)) pick(h.toLowerCase());
            }}
          >
            <input class="input" aria-label="Hex color" placeholder="#RRGGBB" value={hex} maxLength={9} onInput={(e) => setHex(e.currentTarget.value)} />
            <button type="submit" class="btn btn-secondary">Apply</button>
            {typeof window !== 'undefined' && 'EyeDropper' in window && (
              <button type="button" class="icon-btn" aria-label="Pick a color from the screen" title="Eyedropper" onClick={eyedrop}>
                <Icon name="wand" size={16} />
              </button>
            )}
          </form>
        </div>
      </Popover>
    </span>
  );
}
