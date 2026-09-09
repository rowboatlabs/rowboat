import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import Drawer from 'expo-router/drawer';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, useColorScheme, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';

import { GlassHamburger } from '@/components/glass-hamburger';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DrawerContent } from '@/components/drawer-content';
import { registerWithMac } from '@/lib/push';
import { useConnection } from '@/lib/connection';
import { ConnectionProvider } from '@/lib/connection';
import { SpacesAccountProvider } from '@/lib/spaces/account';

SplashScreen.preventAutoHideAsync();

// Chat-first shell (Claude/ChatGPT pattern): the home route IS a chat; the
// left drawer holds history, New chat, Brain, and settings. Everything else
// (pairing, note view) stacks on top.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  // Nothing else hides the native splash — without this the release build
  // sits on the logo forever (Expo Go masks it).
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ConnectionProvider>
          <SpacesAccountProvider>
          <PushRegistrar />
          <Drawer
            drawerContent={(props) => <DrawerContent {...props} />}
            screenOptions={{
              drawerType: 'slide',
              drawerStyle: { width: 300 },
              // A generous swipe zone (~30% of the screen) opens the drawer;
              // pushed screens keep their own edge back-gesture.
              swipeEdgeWidth: width * 0.3,
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
