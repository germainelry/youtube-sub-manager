import { useCallback, useEffect, useState } from 'react';
import {
  type ThemePreference,
  getThemePreference,
  setThemePreference,
  nextThemePreference,
} from './theme';

const ICONS: Record<ThemePreference, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

const LABELS: Record<ThemePreference, string> = {
  system: 'Theme: System',
  light: 'Theme: Light',
  dark: 'Theme: Dark',
};

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    getThemePreference().then(setPref);

    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes['theme']) return;
      setPref(changes['theme'].newValue as ThemePreference);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const cycle = useCallback(() => {
    const next = nextThemePreference(pref);
    setPref(next);
    setThemePreference(next);
  }, [pref]);

  return (
    <button className="theme-toggle" onClick={cycle} title={LABELS[pref]} aria-label={LABELS[pref]}>
      {ICONS[pref]}
    </button>
  );
}
