import { Stack, router } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { Pressable, useColorScheme } from 'react-native';
import { Image } from '@/components/sf-image';

// Spaces is a stack inside the drawer: the org/space list → a space's chat
// pushes with a native back button (same shape as the notes section).
export default function SpacesLayout() {
  const colorScheme = useColorScheme();
  const tint = colorScheme === 'dark' ? '#ffffff' : '#000000';
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: tint,
        // iOS 26: content scrolls under a see-through bar and fades out
        // softly instead of meeting a hard edge. Screens inset themselves
        // (contentInsetAdjustmentBehavior / header height).
        // Android has no automatic content inset, so content slid under the
        // header there; it gets a solid header instead (2026-10-28).
        headerTransparent: process.env.EXPO_OS !== 'android',
        scrollEdgeEffects: { top: 'soft' },
      }}
    >
      {/* The tabs (Home, DMs, Activity, More, search) share this header; the focused tab sets its title and right button. */}
      <Stack.Screen
        name="(tabs)"
        options={({ navigation }) => ({
          title: 'Spaces',
          headerLeft: () => (
            <Pressable
              onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
              hitSlop={10}
              // Android's header sets the title flush against the left button (2026-10-28).
              style={process.env.EXPO_OS === 'android' ? { marginRight: 20 } : undefined}
            >
              <Image source="sf:line.3.horizontal" style={{ width: 22, height: 22 }} tintColor={tint} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/spaces/activity')} hitSlop={10}>
              <Image source="sf:bell" style={{ width: 21, height: 21 }} tintColor={tint} />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen name="activity" options={{ title: 'Activity', headerBackButtonDisplayMode: 'minimal' }} />
      {/* Title set by the screen from its params; native back chevron, no label. */}
      <Stack.Screen name="chat" options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="thread" options={{ title: 'Thread', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="files" options={{ title: 'Files', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="file" options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="video" options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="search" options={{ title: 'Search', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="account" options={{ title: 'Account', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="blocked" options={{ title: 'Blocked users', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="join" options={{ title: 'Join a space', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="invite" options={{ title: 'Invite people', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="members" options={{ title: 'Members', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="add-people" options={{ title: 'Add people', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="new-space" options={{ title: 'New space', headerBackButtonDisplayMode: 'minimal' }} />
      <Stack.Screen name="browse" options={{ title: 'Browse spaces', headerBackButtonDisplayMode: 'minimal' }} />
    </Stack>
  );
}
