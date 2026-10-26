// Link with Couch Party Island (vonrotter.github.io/couch). When this game is opened from the
// island's solo mode as ?profile=<id>&name=<name>&return=<url>&lang=en|no, saves are kept per
// profile and a button leads back to the island. Opened any other way, nothing changes.

interface CouchSession { profile: string; name: string; back: string; lang: string }

const SESSION_KEY = 'couch.session';

/** Only send players back to the island's own site (or a local dev server). */
function safeBack(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const ok = (u.protocol === 'https:' || u.protocol === 'http:') &&
      (u.hostname === location.hostname || u.hostname === 'vonrotter.github.io' || u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    return ok ? u.href : '';
  } catch {
    return '';
  }
}

function readSession(): CouchSession | null {
  const q = new URLSearchParams(location.search);
  const profile = q.get('profile');
  if (profile) {
    const s: CouchSession = { profile, name: q.get('name') ?? '', back: safeBack(q.get('return')), lang: q.get('lang') === 'no' ? 'no' : 'en' };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
    // Tidy the address bar; the tab remembers the profile for reloads.
    for (const k of ['profile', 'name', 'return', 'lang']) q.delete(k);
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    return s;
  }
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as CouchSession | null;
  } catch {
    return null;
  }
}

export const couch: CouchSession | null = readSession();

/** A save key for the current profile ("p.<id>.<key>"), or the key itself when not opened from the island. */
export function profileKey(key: string): string {
  return couch ? `p.${couch.profile}.${key}` : key;
}

/** A small button back to the island, when opened from it. */
export function mountBackButton(): void {
  if (!couch?.back) return;
  const a = document.createElement('a');
  a.href = couch.back;
  a.textContent = couch.lang === 'no' ? `◀ Til øya${couch.name ? ` (${couch.name})` : ''}` : `◀ Back to the island${couch.name ? ` (${couch.name})` : ''}`;
  a.setAttribute('style', [
    'position:fixed', 'left:10px', 'bottom:10px', 'z-index:2147483000', 'padding:6px 12px', 'border-radius:999px',
    'background:rgba(255,255,255,0.88)', 'color:#2b2340', 'font:600 14px/1.2 Fredoka, system-ui, sans-serif',
    'text-decoration:none', 'box-shadow:0 2px 6px rgba(0,0,0,0.25)', 'opacity:0.75',
  ].join(';'));
  a.addEventListener('mouseenter', () => { a.style.opacity = '1'; });
  a.addEventListener('mouseleave', () => { a.style.opacity = '0.75'; });
  document.body.appendChild(a);
}
