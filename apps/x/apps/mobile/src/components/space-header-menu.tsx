import { Stack } from 'expo-router';
import { Image } from '@/components/sf-image';
import { useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Glyph, Group, Row } from '@/components/grouped';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

export type SpaceHeaderItem = {
  key: string;
  label: string;
  /** An SF Symbol name; Android maps it in `lib/symbols.ts`. */
  icon: NonNullable<ComponentProps<typeof Stack.Toolbar.MenuAction>['icon']> & string;
  onPress: () => void;
};

/**
 * A chat's header buttons: Search, then one ⋯ menu for everything else
 * (2026-11-13). Four or five icons pushed iOS's title off-centre, and only in
 * spaces (a DM has no Members), so chats looked different from each other.
 * Two items always leave the title centred. iOS gets a native menu; Android a
 * sheet, as the threads filter does (its toolbar menu drops SF icons).
 */
export function SpaceHeaderMenu({ onSearch, items }: { onSearch: () => void; items: SpaceHeaderItem[] }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  if (process.env.EXPO_OS === 'ios') {
    return (
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search" onPress={onSearch} />
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More">
          {items.map((item) => (
            <Stack.Toolbar.MenuAction key={item.key} icon={item.icon} onPress={item.onPress}>
              {item.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    );
  }
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Pressable hitSlop={10} accessibilityLabel="Search" onPress={onSearch}>
                <Image source="sf:magnifyingglass" style={{ width: 20, height: 20 }} tintColor={colors.label} />
              </Pressable>
              <Pressable hitSlop={10} accessibilityLabel="More" onPress={() => setOpen(true)}>
                <Image source="sf:ellipsis.circle" style={{ width: 21, height: 21 }} contentFit="contain" tintColor={colors.label} />
              </Pressable>
            </View>
          ),
        }}
      />
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        style={{ marginHorizontal: 12, marginBottom: 40, padding: 12, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.groupedBackground }}
      >
        <Group>
          {items.map((item, i) => (
            <Row
              key={item.key}
              first={i === 0}
              onPress={() => {
                setOpen(false);
                item.onPress();
              }}
            >
              <Glyph icon={`sf:${item.icon}`} />
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>{item.label}</Text>
            </Row>
          ))}
        </Group>
      </BottomSheet>
    </>
  );
}
