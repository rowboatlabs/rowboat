import { Stack } from 'expo-router';
import { Image } from '@/components/sf-image';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { HeaderMenu, HeaderMenuButton, type HeaderMenuAnchor } from '@/components/header-menu';
import { useColors } from '@/theme/colors';

export type SpaceHeaderItem = {
  key: string;
  label: string;
  /** An SF Symbol name; Android maps it in `lib/symbols.ts`. */
  icon: string;
  onPress: () => void;
};

/**
 * A chat's header buttons: Search, then one ⋯ menu for everything else
 * (2026-11-13). Four or five icons pushed iOS's title off-centre, and only in
 * spaces (a DM has no Members), so chats looked different from each other.
 * Two items always leave the title centred. The ⋯ menu is our own HeaderMenu
 * on both platforms: the native iOS menu let its dismiss tap through to the chat.
 */
export function SpaceHeaderMenu({ onSearch, items }: { onSearch: () => void; items: SpaceHeaderItem[] }) {
  const colors = useColors();
  const [anchor, setAnchor] = useState<HeaderMenuAnchor | null>(null);
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel="Search" onPress={onSearch}>
                <Image source="sf:magnifyingglass" style={{ width: 20, height: 20 }} tintColor={colors.label} />
              </Pressable>
              <HeaderMenuButton icon="ellipsis.circle" accessibilityLabel="More" onOpen={setAnchor} />
            </View>
          ),
        }}
      />
      <HeaderMenu anchor={anchor} onClose={() => setAnchor(null)} sections={[{ key: 'all', items }]} />
    </>
  );
}
