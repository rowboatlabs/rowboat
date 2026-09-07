import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import type { RpcClient } from '@x/client';

// Push notifications, phone side: ask permission, mint the Expo push token,
// and register {token, level} with the paired Mac — the Mac's mention watcher
// does the sending (see core/spaces/phone-push.ts). Levels are global v1.

export type PushLevel = 'off' | 'mentions' | 'dms' | 'all';
export const PUSH_LEVELS: { key: PushLevel; label: string; detail: string }[] = [
  { key: 'all', label: 'Everything', detail: 'Every message in your spaces and DMs' },
  { key: 'dms', label: 'DMs and mentions', detail: 'Direct messages, @you and @here' },
  { key: 'mentions', label: 'Mentions only', detail: '@you and @here' },
  { key: 'off', label: 'Off', detail: 'No push notifications' },
];

const LEVEL_KEY = 'rowboat.push.level.v1';
const DEFAULT_LEVEL: PushLevel = 'dms';

// Foreground presentation: show banners while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getPushLevel(): Promise<PushLevel> {
  try {
    const raw = await AsyncStorage.getItem(LEVEL_KEY);
    return (raw as PushLevel | null) ?? DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

export async function setPushLevel(level: PushLevel): Promise<void> {
  await AsyncStorage.setItem(LEVEL_KEY, level).catch(() => {});
}

/** Permission + Expo push token. Null when denied or unavailable (simulator). */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators cannot receive remote pushes
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return null;
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}

/** Send the current token+level to the paired Mac. Safe to call repeatedly. */
export async function registerWithMac(rpc: RpcClient): Promise<'registered' | 'no-permission' | 'unavailable'> {
  const level = await getPushLevel();
  const token = await getPushToken();
  if (!token) return Device.isDevice ? 'no-permission' : 'unavailable';
  await rpc.call('phone:push:register', {
    token,
    level,
    deviceName: Device.deviceName ?? undefined,
  });
  return 'registered';
}
