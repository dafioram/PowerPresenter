// Link editor (spec §5.10): web addresses, slide links and navigation links.
// Resolves with a link object, null to remove the link, or undefined to cancel.
import { useState } from 'preact/hooks';
import { Dialog, Button, Segmented, Select } from '../../ui/components.jsx';
import { isAllowedUrl } from '../../../core/validate.js';
import { slideOrder } from '../../../core/model.js';
import { resolveSlideTitle } from '../../../core/titles.js';

export function normalizeUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  if (/^\+?[0-9][0-9 ()-]{5,}$/.test(t)) return `tel:${t.replace(/[^0-9+]/g, '')}`;
  return `https://${t}`;
}

export function LinkDialog({ close, value, doc, hasText }) {
  const [kind, setKind] = useState(value?.kind || 'url');
  const [href, setHref] = useState(value?.kind === 'url' ? value.href : '');
  const order = slideOrder(doc);
  const [slideId, setSlideId] = useState(value?.kind === 'slide' ? value.slide_id : order[0]);
  const [nav, setNav] = useState(value?.kind === 'nav' ? value.target : 'next');
  const [error, setError] = useState('');

  const submit = (e) => {
    e?.preventDefault();
    if (kind === 'url') {
      const url = normalizeUrl(href);
      if (!isAllowedUrl(url)) {
        setError('Enter a web address (https://…), an email address or a phone number.');
        return;
      }
      close({ kind: 'url', href: url });
    } else if (kind === 'slide') {
      close({ kind: 'slide', slide_id: slideId });
    } else close({ kind: 'nav', target: nav });
  };

  return (
    <Dialog
      title={value ? 'Edit link' : 'Add link'}
      onClose={() => close(undefined)}
      width={480}
      footer={
        <>
          {value && <Button variant="ghost" class="grow-left" onClick={() => close(null)}>Remove link</Button>}
          <span class="spacer" />
          <Button onClick={() => close(undefined)}>Cancel</Button>
          <Button variant="primary" onClick={submit} data-testid="link-apply">Apply</Button>
        </>
      }
    >
      <form class="stack" onSubmit={submit}>
        <Segmented label="Link to" value={kind} onChange={(v) => { setKind(v); setError(''); }} options={[{ value: 'url', label: 'Web address' }, { value: 'slide', label: 'Slide' }, { value: 'nav', label: 'Navigation' }]} />
        {kind === 'url' && (
          <label class="field">
            <span class="field-label">Address</span>
            <input class="input" value={href} placeholder="https://example.com" onInput={(e) => { setHref(e.currentTarget.value); setError(''); }} data-autofocus aria-invalid={!!error} maxLength={2048} />
            {error ? <span class="field-hint is-error" role="alert">{error}</span> : <span class="field-hint">Web links open in a new tab when presenting.{hasText ? ' With no text selected, the address is inserted.' : ''}</span>}
          </label>
        )}
        {kind === 'slide' && (
          <Select
            label="Slide"
            value={slideId}
            onChange={setSlideId}
            options={order.map((id, i) => ({ value: id, label: `${i + 1}. ${resolveSlideTitle(doc.slides[id]) || 'Untitled slide'}${doc.slides[id].hidden ? ' (hidden)' : ''}` }))}
          />
        )}
        {kind === 'nav' && (
          <Select label="Go to" value={nav} onChange={setNav} options={[{ value: 'next', label: 'Next slide' }, { value: 'previous', label: 'Previous slide' }, { value: 'first', label: 'First slide' }, { value: 'last', label: 'Last slide' }]} />
        )}
      </form>
    </Dialog>
  );
}
