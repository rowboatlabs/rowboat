import { Stack } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { Pressable, useColorScheme } from 'react-native';
import { Image } from 'expo-image';

// Notes are a stack inside the drawer: Brain (tree) → note pushes with a
// native back button. The drawer's own header is hidden for this section —
// the stack draws its own, so Brain re-adds the hamburger itself.
export default function NotesLayout() {
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
          title: 'Brain',
          // Plain hamburger, matching the standard drawer header look.
          headerLeft: () => (
            <Pressable onPress={() => navigation.dispatch(DrawerActions.openDrawer())} hitSlop={10}>
              <Image source="sf:line.3.horizontal" style={{ width: 22, height: 22 }} tintColor={tint} />
            </Pressable>
          ),
        })}
      />
      {/* Native back chevron, no label. */}
      <Stack.Screen name="view" options={{ title: 'Note', headerBackButtonDisplayMode: 'minimal' }} />
    </Stack>
  );
}
