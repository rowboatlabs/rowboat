import { router, useNavigation } from 'expo-router';
import { Pressable } from 'react-native';
import { Image } from '@/components/sf-image';
import { useColors } from '@/theme/colors';

// A link that launches the app opens its chat or thread as the only screen in
// the Spaces stack (2026-11-10), so iOS draws no back button. This one leads
// Home instead; anywhere else the stack's own back button stays.
export function useHomeBackButton(): (() => React.ReactNode) | undefined {
  const navigation = useNavigation();
  const colors = useColors();
  if (navigation.getState()?.index !== 0) return undefined;
  return () => (
    <Pressable hitSlop={10} accessibilityLabel="Home" onPress={() => router.replace('/spaces')}>
      <Image source="sf:chevron.left" style={{ width: 20, height: 20 }} contentFit="contain" tintColor={colors.label} />
    </Pressable>
  );
}
