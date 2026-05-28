export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'theme';

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export async function getThemePreference(): Promise<ThemePreference> {
  const result = await chrome.storage.local.get(THEME_KEY);
  const val = result[THEME_KEY];
  if (val === 'light' || val === 'dark' || val === 'system') return val;
  return 'system';
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: pref });
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === 'system') return 'light';
  if (current === 'light') return 'dark';
  return 'system';
}

export function initTheme(onThemeChange?: (resolved: ResolvedTheme) => void): () => void {
  let currentPref: ThemePreference = 'system';

  getThemePreference().then((pref) => {
    currentPref = pref;
    const resolved = resolveTheme(pref);
    applyTheme(resolved);
    onThemeChange?.(resolved);
  });

  const storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[THEME_KEY]) return;
    const pref = changes[THEME_KEY].newValue as ThemePreference;
    currentPref = pref;
    const resolved = resolveTheme(pref);
    applyTheme(resolved);
    onThemeChange?.(resolved);
  };
  chrome.storage.onChanged.addListener(storageListener);

  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const mediaListener = () => {
    if (currentPref !== 'system') return;
    const resolved = resolveTheme('system');
    applyTheme(resolved);
    onThemeChange?.(resolved);
  };
  mql.addEventListener('change', mediaListener);

  return () => {
    chrome.storage.onChanged.removeListener(storageListener);
    mql.removeEventListener('change', mediaListener);
  };
}
