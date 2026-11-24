import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { dark as darkColors, light as lightColors } from '@/theme/colors';
import { applyStoredTheme } from '@/lib/theme-preference';

const WarmDarkTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: darkColors.background, card: darkColors.background, border: darkColors.separator, text: darkColors.label },
};

// Pin the saved Light/Dark choice before the first screen paints.
void applyStoredTheme();

// Navigation chrome (headers, screen ground, drawer) on the same warm white.
const LightTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: lightColors.background, card: lightColors.background, border: lightColors.separator, text: lightColors.label },
};
import Drawer from 'expo-router/drawer';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, useColorScheme, useWindowDimensions } from 'react-native';
import { Image } from '@/components/sf-image';

import { GlassHamburger } from '@/components/glass-hamburger';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import * as Notifications from 'expo-notifications';
import { router, usePathname, useRootNavigationState } from 'expo-router';

import { DrawerContent } from '@/components/drawer-content';
import { registerWithMac } from '@/lib/push';
import { useConnection } from '@/lib/connection';
import { ConnectionProvider } from '@/lib/connection';
import { SpacesAccountProvider, useSpacesAccount } from '@/lib/spaces/account';

SplashScreen.preventAutoHideAsync();

// Chat-first shell (Claude/ChatGPT pattern): the home route IS a chat; the
// left drawer holds history, New chat, Brain, and settings. Everything else
// (pairing, note view) stacks on top.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const palette = colorScheme === 'dark' ? darkColors : lightColors;
  const { width } = useWindowDimensions();
  // Nothing else hides the native splash — without this the release build
  // sits on the logo forever (Expo Go masks it).
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
      <ThemeProvider value={colorScheme === 'dark' ? WarmDarkTheme : LightTheme}>
        <ConnectionProvider>
          <SpacesAccountProvider>
          <PushRegistrar />
          <PushNavigator />
          {/* Android leaves light status-bar icons on our light pages; follow the
              app's scheme (2026-10-28). iOS already adapts on its own. */}
          {process.env.EXPO_OS === 'android' ? <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} /> : null}
          <Drawer
            drawerContent={(props) => <DrawerContent {...props} />}
            screenOptions={{
              // 'front': the panel slides OVER the page, so its rounded corners
              // show the real (dimmed) page behind them. With 'slide' the
              // panel sits beside the page and the corners expose the root's
              // ground instead — a faint square around the curve.
              drawerType: 'front',
              drawerStyle: {
                width: 300, overflow: 'hidden', backgroundColor: palette.background,
                borderTopRightRadius: 28, borderBottomRightRadius: 28, borderCurve: 'continuous',
              },
              // A generous swipe zone (~30% of the screen) opens the drawer;
              // pushed screens keep their own edge back-gesture.
              swipeEdgeWidth: width * 0.3,
              overlayColor: 'rgba(0,0,0,0.35)',
              headerShadowVisible: false,
              headerTintColor: colorScheme === 'dark' ? '#ffffff' : '#000000',
            }}
          >
            {/* Home just redirects into Spaces (or first-launch onboarding). */}
            <Drawer.Screen name="index" options={{ headerShown: false }} />
            <Drawer.Screen name="onboarding" options={{ headerShown: false, swipeEnabled: false }} />
            {/* Floating hamburger in a glass circle: transparent header, no divider. */}
            <Drawer.Screen
              name="chat"
              options={({ navigation }) => ({
                title: 'Mac chat',
                headerTitle: '',
                headerTransparent: true,
                headerLeft: () => <GlassHamburger onPress={() => navigation.openDrawer()} />,
              })}
            />
            <Drawer.Screen name="spaces" options={{ title: 'Spaces', headerShown: false }} />
            <Drawer.Screen
              name="pairing"
              options={({ navigation }) => ({
                title: 'Connect your Mac',
                headerTitle: '',
                swipeEnabled: false,
                headerShown: true,
                // Same plain hamburger as the Spaces header.
                headerLeft: () => (
                  <Pressable onPress={() => navigation.openDrawer()} hitSlop={10} style={{ marginLeft: 16 }}>
                    <Image
                      source="sf:line.3.horizontal"
                      style={{ width: 22, height: 22 }}
                      tintColor={colorScheme === 'dark' ? '#ffffff' : '#000000'}
                    />
                  </Pressable>
                ),
              })}
            />
            <Drawer.Screen name="notes" options={{ title: 'Brain', headerShown: false }} />
            <Drawer.Screen name="pair-dev" options={{ title: 'Dev pairing', headerShown: false }} />
            <Drawer.Screen name="notifications" options={{ title: 'Notifications', headerShown: true }} />
          </Drawer>
          </SpacesAccountProvider>
        </ConnectionProvider>
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// Re-register the phone's push token + level whenever the Mac connects —
// tokens rotate and prefs change; the call is idempotent.
function PushRegistrar() {
  const { rpc, status } = useConnection();
  useEffect(() => {
    if (status === 'connected' && rpc) void registerWithMac(rpc).catch(() => {});
  }, [status, rpc]);
  return null;
}

// A tapped push lands on its conversation: the payload carries orgId /
// spaceId / threadRootId (push.ts on the org); the org list maps id → address.
function PushNavigator() {
  const account = useSpacesAccount();
  const pathname = usePathname();
  const navReady = Boolean(useRootNavigationState()?.key);
  // Each notification response is handled ONCE (2026-10-07): the listener and
  // getLastNotificationResponse can both answer the same tap, and replaying
  // it pushed chat + thread again so back walked through the copies.
  const handled = useRef(new Set<string>());
  // A tap is held until the app can act on it (2026-11-09). On a cold start
  // the tap arrived before the navigator was ready and before Home's redirect
  // into Spaces: the push was dropped, or the redirect landed after it and
  // replaced it — and the tap was already marked handled, so it never retried.
  // The app opened on Spaces home instead of the message.
  const [pending, setPending] = useState<Notifications.NotificationResponse | null>(null);
  useEffect(() => {
    const take = (r: Notifications.NotificationResponse) => {
      if (!handled.current.has(responseKey(r))) setPending(r);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) take(last);
    const sub = Notifications.addNotificationResponseReceivedListener(take);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    // pathname '/' = Home has not redirected into Spaces yet.
    if (!pending || !navReady || pathname === '/') return;
    const data = pending.notification.request.content.data as Record<string, unknown> | undefined;
    const orgId = typeof data?.orgId === 'string' ? data.orgId : null;
    const spaceId = typeof data?.spaceId === 'string' ? data.spaceId : null;
    const threadRootId = typeof data?.threadRootId === 'string' ? data.threadRootId : null;
    if (!spaceId) {
      setPending(null);
      return;
    }
    // Not in the org list yet: wait for the cached or refreshed list.
    const org = account.orgs?.find((o) => o.id === orgId);
    if (!org) return;
    handled.current.add(responseKey(pending));
    setPending(null);
    Notifications.clearLastNotificationResponse();
    const base = { org: org.address, space: spaceId, me: org.memberId };
    // From the tabs: back from the thread goes to the channel, then home.
    if (router.canDismiss()) router.dismissAll();
    router.push({ pathname: '/spaces/chat', params: base });
    if (threadRootId) router.push({ pathname: '/spaces/thread', params: { ...base, root: threadRootId, title: 'Thread', focus: 'latest' } });
  }, [pending, navReady, pathname, account.orgs]);
  return null;
}

function responseKey(r: Notifications.NotificationResponse): string {
  return `${r.notification.request.identifier}:${r.notification.date}`;
}
