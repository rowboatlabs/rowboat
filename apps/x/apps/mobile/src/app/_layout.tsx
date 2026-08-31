import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { ConnectionProvider } from '@/lib/connection';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ConnectionProvider>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="pairing" options={{ title: 'Pair with your Mac' }} />
          <Stack.Screen name="sessions/index" options={{ title: 'Chats' }} />
          <Stack.Screen name="sessions/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="notes/index" options={{ title: 'Notes' }} />
          <Stack.Screen name="notes/view" options={{ title: 'Note' }} />
          <Stack.Screen name="spike" options={{ title: 'Shared package spike' }} />
        </Stack>
      </ConnectionProvider>
    </ThemeProvider>
  );
}
