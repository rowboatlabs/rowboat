import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import Drawer from 'expo-router/drawer';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { GlassHamburger } from '@/components/glass-hamburger';
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
                headerLeft: () => <GlassHamburger onPress={() => navigation.openDrawer()} />,
              })}
            />
            <Drawer.Screen name="pairing" options={{ title: 'Pair with your Mac', swipeEnabled: false, headerShown: true }} />
            <Drawer.Screen name="notes" options={{ title: 'Brain', headerShown: false }} />
            <Drawer.Screen name="pair-dev" options={{ title: 'Dev pairing', headerShown: false }} />
          </Drawer>
        </ConnectionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
