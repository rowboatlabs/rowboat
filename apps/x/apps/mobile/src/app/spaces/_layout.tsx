import { Stack } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { Pressable, useColorScheme } from 'react-native';
import { Image } from 'expo-image';

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
      }}
    >
      <Stack.Screen
        name="index"
        options={({ navigation }) => ({
          title: 'Spaces',
          headerLeft: () => (
            <Pressable onPress={() => navigation.dispatch(DrawerActions.openDrawer())} hitSlop={10}>
              <Image source="sf:line.3.horizontal" style={{ width: 22, height: 22 }} tintColor={tint} />
            </Pressable>
          ),
        })}
      />
      {/* Title set by the screen from its params; native back chevron, no label. */}
      <Stack.Screen name="chat" options={{ title: '', headerBackButtonDisplayMode: 'minimal' }} />
    </Stack>
  );
}
