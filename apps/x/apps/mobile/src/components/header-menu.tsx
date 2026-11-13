import { Image } from '@/components/sf-image';
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// A header button's dropdown menu, drawn by us (2026-11-13). The iOS menus were
// native UIMenus (expo-router's Stack.Toolbar.Menu), and the tap that dismissed
// one also reached the screen under it, opening a thread or a message. Neither
// expo-router 57 nor react-native-screens 4.26 says when the menu opens or
// closes, so nothing could block that tap. Here a full-screen backdrop closes
// the menu and swallows the tap. Android uses the same menu, so both behave alike.

export type HeaderMenuItem = {
  key: string;
  label: string;
  /** A second line under the label, e.g. what a picker is set to. */
  subtitle?: string;
  /** An SF Symbol name, drawn after the label; Android maps it in `lib/symbols.ts`. */
  icon?: string;
  /** Pick-one rows: true shows the checkmark. Leave unset on rows that aren't picks. */
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
};

export type HeaderMenuSection = { key: string; title?: string; items: HeaderMenuItem[] };

/** Where the button sits on screen, from `measureInWindow`. */
export type HeaderMenuAnchor = { x: number; y: number; width: number; height: number };

/** The header button: measures itself on press, so the menu opens under it. */
export function HeaderMenuButton({ icon, accessibilityLabel, onOpen, size = 21 }: {
  icon: string;
  accessibilityLabel: string;
  onOpen: (anchor: HeaderMenuAnchor) => void;
  size?: number;
}) {
  const colors = useColors();
  const ref = useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        const node = ref.current;
        if (!node) return onOpen({ x: 0, y: 0, width: 0, height: 0 });
        node.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }));
      }}
    >
      <Image source={`sf:${icon}`} style={{ width: size, height: size }} contentFit="contain" tintColor={colors.label} />
    </Pressable>
  );
}

/**
 * The menu, open while `anchor` is set. Picking a row closes the menu first and
 * runs the row's action once the menu is gone: an action that opens a sheet
 * (another Modal) can't show while this one is still dismissing on iOS.
 */
export function HeaderMenu({ anchor, onClose, sections }: {
  anchor: HeaderMenuAnchor | null;
  onClose: () => void;
  sections: HeaderMenuSection[];
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const pending = useRef<(() => void) | null>(null);
  // Keep drawing the last position while the Modal fades out.
  const [shown, setShown] = useState<HeaderMenuAnchor | null>(anchor);
  if (anchor && anchor !== shown) setShown(anchor);

  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const pick = (item: HeaderMenuItem) => {
    pending.current = item.onPress;
    onClose();
    // Android has no onDismiss, and iOS's has been known to skip a beat: a
    // fallback that only fires if onDismiss hasn't already.
    setTimeout(runPending, process.env.EXPO_OS === 'ios' ? 400 : 0);
  };

  const at = shown;
  // Under the button, right edges lined up; with no measurement, under the header's top-right.
  const top = at && at.height > 0 ? at.y + at.height + 8 : insets.top + 52;
  const right = at && at.width > 0 ? Math.max(8, screenWidth - (at.x + at.width)) : 16;
  const visible = sections.filter((s) => s.items.length > 0);

  return (
    <Modal
      transparent
      visible={anchor !== null}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <Pressable accessibilityLabel="Close menu" style={{ flex: 1 }} onPress={onClose}>
        {/* A tap on the card between rows (a section title) stays in the menu. */}
        <Pressable
          accessible={false}
          onPress={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top, right, minWidth: 220, maxWidth: Math.min(290, screenWidth - 32),
            maxHeight: screenHeight - top - insets.bottom - 16,
            borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.secondaryBackground,
            boxShadow: colors.isDark ? '0 10px 40px rgba(0,0,0,0.6)' : '0 10px 40px rgba(0,0,0,0.18)',
          }}
        >
          <ScrollView bounces={false} style={{ flexGrow: 0, borderRadius: 14, borderCurve: 'continuous' }}>
            {visible.map((section, s) => (
              <View key={section.key}>
                {s > 0 ? <View style={{ height: 8, backgroundColor: colors.separator }} /> : null}
                {section.title ? (
                  <Text style={{ ...type.caption, color: colors.tertiaryLabel, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>{section.title}</Text>
                ) : null}
                {section.items.map((item, i) => (
                  <MenuRow key={item.key} item={item} first={i === 0 && !section.title} picks={section.items.some((it) => it.selected !== undefined)} onPress={() => pick(item)} />
                ))}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuRow({ item, first, picks, onPress }: { item: HeaderMenuItem; first: boolean; picks: boolean; onPress: () => void }) {
  const colors = useColors();
  const tint = item.destructive ? colors.destructive : colors.label;
  let check: ReactNode = null;
  if (picks) {
    check = (
      <View style={{ width: 18, alignItems: 'center' }}>
        {item.selected ? <Image source="sf:checkmark" style={{ width: 14, height: 14 }} contentFit="contain" tintColor={tint} /> : null}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={item.subtitle ? `${item.label}, ${item.subtitle}` : item.label}
      accessibilityState={item.selected === undefined ? undefined : { selected: item.selected }}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.separator : 'transparent' })}
    >
      {first ? null : <View style={{ height: 0.5, backgroundColor: colors.separator }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 10, paddingLeft: picks ? 10 : 16, paddingRight: 16 }}>
        {check}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ ...type.body, color: tint }}>{item.label}</Text>
          {item.subtitle ? <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>{item.subtitle}</Text> : null}
        </View>
        {item.icon ? <Image source={`sf:${item.icon}`} style={{ width: 19, height: 19 }} contentFit="contain" tintColor={tint} /> : null}
      </View>
    </Pressable>
  );
}
