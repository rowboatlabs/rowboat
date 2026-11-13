import { Button, Host, Image as SwiftImage, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel } from '@expo/ui/swift-ui/modifiers';
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
  icon: NonNullable<ComponentProps<typeof Button>['systemImage']>;
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
    // A SwiftUI Menu in a Host instead of Stack.Toolbar.Menu (2026-11-13):
    // still a real iOS menu, so the native look stays (the JS drop-down was
    // rejected), and this tests whether the tap that dismisses it still
    // reaches the chat underneath. @expo/ui gives no open/close state, so
    // there's no blocker to put up while it's open.
    return (
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Pressable hitSlop={10} accessibilityLabel="Search" onPress={onSearch}>
                <Image source="sf:magnifyingglass" style={{ width: 20, height: 20 }} tintColor={colors.label} />
              </Pressable>
              <Host matchContents>
                <Menu
                  label={<SwiftImage systemName="ellipsis.circle" size={20} color={colors.label} />}
                  modifiers={[accessibilityLabel('More')]}
                >
                  {items.map((item) => (
                    <Button key={item.key} label={item.label} systemImage={item.icon} onPress={item.onPress} />
                  ))}
                </Menu>
              </Host>
            </View>
          ),
        }}
      />
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
