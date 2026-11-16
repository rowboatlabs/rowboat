import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

// Appearance override: System follows iOS; Light/Dark pin the whole app —
// native chrome included (headers, alerts, keyboard) — via Appearance.
// useColorScheme() everywhere then reports the pinned scheme.

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_PREFS: { key: ThemePref; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const KEY = 'rowboat.theme.v1';

function apply(pref: ThemePref): void {
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

export async function getThemePref(): Promise<ThemePref> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  apply(pref);
  await AsyncStorage.setItem(KEY, pref).catch(() => {});
}

/** At launch: re-pin whatever the user chose last time. */
export async function applyStoredTheme(): Promise<void> {
  const pref = await getThemePref();
  if (pref !== 'system') apply(pref);
}
