import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Pressable, useColorScheme } from 'react-native';

// The one hamburger: glass circle, identical on every screen that opens the
// drawer.
export function GlassHamburger({ onPress, marginLeft = 14, size = 44 }: { onPress: () => void; marginLeft?: number; size?: number }) {
  const colorScheme = useColorScheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ marginLeft }}>
      <BlurView
        intensity={40}
        tint={colorScheme === 'dark' ? 'dark' : 'light'}
        style={{
          width: size, height: size, borderRadius: size / 2,
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
  );
}
