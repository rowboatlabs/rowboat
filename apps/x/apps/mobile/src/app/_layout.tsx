import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import Drawer from 'expo-router/drawer';
import * as SplashScreen from 'expo-splash-screen';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Pressable, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DrawerContent } from '@/components/drawer-content';
import { ConnectionProvider } from '@/lib/connection';

SplashScreen.preventAutoHideAsync();

// Chat-first shell (Claude/ChatGPT pattern): the home route IS a chat; the
// left drawer holds history, New chat, Brain, and settings. Everything else
// (pairing, note view) stacks on top.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ConnectionProvider>
          <Drawer
            drawerContent={(props) => <DrawerContent {...props} />}
            screenOptions={{
              drawerType: 'slide',
              drawerStyle: { width: 300 },
              headerShadowVisible: false,
              headerTintColor: colorScheme === 'dark' ? '#ffffff' : '#000000',
            }}
          >
            {/* Floating hamburger in a glass circle: transparent header, no divider. */}
            <Drawer.Screen
              name="index"
              options={({ navigation }) => ({
                title: 'Rowboat',
                headerTitle: '',
                headerTransparent: true,
                headerLeft: () => (
                  <Pressable onPress={() => navigation.openDrawer()} hitSlop={8} style={{ marginLeft: 14 }}>
                    <BlurView
                      intensity={40}
                      tint={colorScheme === 'dark' ? 'dark' : 'light'}
                      style={{
                        width: 44, height: 44, borderRadius: 22,
                        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
                        borderWidth: 0.5,
                        borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
                        backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                      }}
                    >
                      <Image
                        source="sf:line.3.horizontal"
                        style={{ width: 22, height: 22 }}
                        tintColor={colorScheme === 'dark' ? '#ffffff' : '#000000'}
                      />
                    </BlurView>
                  </Pressable>
                ),
              })}
            />
            <Drawer.Screen name="pairing" options={{ title: 'Pair with your Mac', swipeEnabled: false, headerShown: true }} />
            <Drawer.Screen name="notes/index" options={{ title: 'Brain' }} />
            <Drawer.Screen name="notes/view" options={{ title: 'Note' }} />
            <Drawer.Screen name="pair-dev" options={{ title: 'Dev pairing', headerShown: false }} />
          </Drawer>
        </ConnectionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
