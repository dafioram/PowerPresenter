// Client-side routes: the workspace at ./ and the editor at ./?p=<id>.
// Presenting adds #slide-<n> (spec §14.7).
export function currentRoute() {
  const p = new URLSearchParams(location.search).get('p');
  return p && /^[A-Za-z0-9_-]{1,64}$/.test(p) ? { name: 'editor', id: p } : { name: 'workspace' };
}

export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new Event('pe-route'));
}

export function openPresentation(id) {
  const url = new URL(location.href);
  navigate(`${url.pathname}?p=${encodeURIComponent(id)}`);
}

export function goWorkspace() {
  navigate(new URL(location.href).pathname);
}
