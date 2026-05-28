import type { ResolvedTheme } from '../shared/theme';

const OVERLAY_ID = 'yt-cleanup-overlay';

const COLORS = {
  dark: {
    bg: '#0f0f0f',
    text: '#fff',
    border: '#303030',
    secondary: '#aaa',
    error: '#ff6b6b',
    shadow: 'rgba(0,0,0,0.4)',
  },
  light: {
    bg: '#ffffff',
    text: '#111111',
    border: '#dddddd',
    secondary: '#555555',
    error: '#cc3333',
    shadow: 'rgba(0,0,0,0.10)',
  },
};

interface OverlayState {
  root: HTMLDivElement;
  countEl: HTMLSpanElement;
  statusEl: HTMLSpanElement;
  theme: ResolvedTheme;
}

let state: OverlayState | null = null;

export async function showOverlay(titleText = 'Extracting subscriptions'): Promise<void> {
  if (state) return;

  let theme: ResolvedTheme = 'dark';
  try {
    const result = await chrome.storage.local.get('theme');
    const pref = result['theme'];
    if (pref === 'light') {
      theme = 'light';
    } else if (pref === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch {
    /* default to dark */
  }

  const c = COLORS[theme];

  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.setAttribute(
    'style',
    [
      'position:fixed',
      'top:80px',
      'right:24px',
      'z-index:2147483647',
      `background:${c.bg}`,
      `color:${c.text}`,
      `border:1px solid ${c.border}`,
      'border-radius:12px',
      'padding:14px 18px',
      'font-family:Roboto,Arial,sans-serif',
      'font-size:13px',
      `box-shadow:0 4px 16px ${c.shadow}`,
      'min-width:220px',
    ].join(';'),
  );

  const title = document.createElement('div');
  title.textContent = titleText;
  title.setAttribute('style', `font-weight:600;margin-bottom:6px;color:${c.text}`);

  const line = document.createElement('div');
  line.setAttribute(
    'style',
    `display:flex;justify-content:space-between;gap:12px;color:${c.secondary}`,
  );

  const countEl = document.createElement('span');
  countEl.textContent = '0 channels';
  countEl.setAttribute('style', `color:${c.text};font-variant-numeric:tabular-nums`);

  const statusEl = document.createElement('span');
  statusEl.textContent = 'Scrolling…';

  line.appendChild(countEl);
  line.appendChild(statusEl);
  root.appendChild(title);
  root.appendChild(line);
  document.body.appendChild(root);

  state = { root, countEl, statusEl, theme };
}

export function updateOverlay(count: number, status: string, total?: number): void {
  if (!state) return;
  state.countEl.textContent =
    total != null
      ? `${count.toLocaleString()} of ${total.toLocaleString()}`
      : `${count.toLocaleString()} channel${count === 1 ? '' : 's'}`;
  state.statusEl.textContent = status;
}

export function setOverlayComplete(total: number, durationMs: number): void {
  if (!state) return;
  const secs = Math.max(1, Math.round(durationMs / 1000));
  state.countEl.textContent = `${total.toLocaleString()} channels`;
  state.statusEl.textContent = `Done · ${secs}s`;
  setTimeout(removeOverlay, 6000);
}

export function setOverlayError(message: string): void {
  if (!state) return;
  const c = COLORS[state.theme];
  state.statusEl.textContent = `Error: ${message}`;
  state.statusEl.setAttribute('style', `color:${c.error}`);
  setTimeout(removeOverlay, 8000);
}

export function removeOverlay(): void {
  if (!state) return;
  state.root.remove();
  state = null;
}
