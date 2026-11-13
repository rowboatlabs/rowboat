import { SegmentedControl } from '@expo/ui/community/segmented-control';
import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { Image } from '@/components/sf-image';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ThreadStatus } from '@rowboat/spaces-protocol';

import { Avatar } from '@/components/avatar';
import { BottomSheet } from '@/components/bottom-sheet';
import { Chevron, Glyph, Group, Row, Tick } from '@/components/grouped';
import { THREAD_KINDS, threadStatusLabel, type ThreadItem, type ThreadsFilters, type ThreadsKind } from '@/lib/spaces/threads';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// The threads lists' pieces (2026-11-13), shared by a space's Threads screen
// and Your threads: the filters (web FilterTabs + ParticipantFilter +
// SpaceFilter), and the rows (web thread-list.tsx). A row taps open its
// thread and long-presses for the thread's options.

/** Whether anything narrows the list beyond Active/Archived. */
export function isFiltered(filters: ThreadsFilters): boolean {
  return filters.kind !== 'all' || filters.people.length > 0 || filters.spaces.length > 0;
}

/** The same Active/Archived side, every other filter off. */
export function clearedFilters(filters: ThreadsFilters): ThreadsFilters {
  return { ...filters, kind: 'all', people: [], spaces: [] };
}

/** "Sessions · Ana · 2 spaces": what the list is narrowed to, or null when it isn't. */
export function filterSummary(filters: ThreadsFilters, nameOf: (id: string) => string, spaceName: (id: string) => string): string | null {
  const count = (ids: string[], name: (id: string) => string, noun: string) =>
    ids.length === 0 ? null : ids.length === 1 ? name(ids[0]!) : `${ids.length} ${noun}`;
  const parts = [
    filters.kind === 'all' ? null : THREAD_KINDS.find((k) => k.key === filters.kind)?.label ?? null,
    count(filters.people, nameOf, 'people'),
    count(filters.spaces, spaceName, 'spaces'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const FILTER_ICON = 'line.3.horizontal.decrease.circle';

/**
 * Active / Archived as a segmented control, everything else behind one filter
 * button in the header (2026-11-13). Two rows of look-alike chips hid which
 * groups were single-pick and which were toggles, and took two rows; now the
 * one choice everybody makes sits on screen, and the rest is a native menu
 * (iOS) or a sheet (Android: the toolbar menu drops SF icons there), with a
 * one-line summary that clears in a tap while anything is on.
 */
export function ThreadFilters({ filters, onChange, archivedCount, people, nameOf, spaces }: {
  filters: ThreadsFilters;
  onChange: (next: ThreadsFilters) => void;
  /** Shown on the Archived segment, as the web's pill shows it. */
  archivedCount?: number;
  /** Everyone in the threads on screen, to filter by. */
  people: string[];
  nameOf: (memberId: string) => string;
  /** Your threads only: the spaces they live in. */
  spaces?: { id: string; name: string }[];
}) {
  const colors = useColors();
  const [sheet, setSheet] = useState<'filters' | 'people' | 'spaces' | null>(null);
  const spaceName = (id: string) => spaces?.find((s) => s.id === id)?.name ?? 'Space';
  const filtered = isFiltered(filters);
  const summary = filterSummary(filters, nameOf, spaceName);
  const peopleSummary = filterSummary({ ...clearedFilters(filters), people: filters.people }, nameOf, spaceName);
  const spacesSummary = filterSummary({ ...clearedFilters(filters), spaces: filters.spaces }, nameOf, spaceName);
  const pickKind = (kind: ThreadsKind) => onChange({ ...filters, kind });
  return (
    <View style={{ gap: 10 }}>
      {process.env.EXPO_OS === 'ios' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={filtered ? `${FILTER_ICON}.fill` : FILTER_ICON} accessibilityLabel="Filter threads">
            <Stack.Toolbar.Menu inline title="Show">
              {THREAD_KINDS.map((k) => (
                <Stack.Toolbar.MenuAction key={k.key} isOn={filters.kind === k.key} onPress={() => pickKind(k.key)}>
                  {k.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction icon="person.2" subtitle={peopleSummary ?? undefined} onPress={() => setSheet('people')}>
                People…
              </Stack.Toolbar.MenuAction>
              {spaces ? (
                <Stack.Toolbar.MenuAction icon="number" subtitle={spacesSummary ?? undefined} onPress={() => setSheet('spaces')}>
                  Spaces…
                </Stack.Toolbar.MenuAction>
              ) : null}
            </Stack.Toolbar.Menu>
            {filtered ? (
              <Stack.Toolbar.MenuAction icon="xmark.circle" onPress={() => onChange(clearedFilters(filters))}>
                Clear filters
              </Stack.Toolbar.MenuAction>
            ) : null}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <Pressable hitSlop={10} accessibilityLabel="Filter threads" onPress={() => setSheet('filters')}>
                <Image source={`sf:${FILTER_ICON}${filtered ? '.fill' : ''}`} style={{ width: 22, height: 22 }} tintColor={colors.label} />
              </Pressable>
            ),
          }}
        />
      )}
      <SegmentedControl
        values={['Active', archivedCount ? `Archived (${archivedCount})` : 'Archived']}
        selectedIndex={filters.archived ? 1 : 0}
        onChange={(e) => onChange({ ...filters, archived: e.nativeEvent.selectedSegmentIndex === 1 })}
        style={{ marginHorizontal: 16 }}
      />
      {summary ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20 }}>
          <Image source={`sf:${FILTER_ICON}`} style={{ width: 14, height: 14 }} tintColor={colors.secondaryLabel} />
          <Text numberOfLines={1} style={{ flex: 1, ...type.caption, color: colors.secondaryLabel }}>{summary}</Text>
          <Pressable
            hitSlop={12}
            accessibilityLabel="Clear filters"
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
              onChange(clearedFilters(filters));
            }}
          >
            <Image source="sf:xmark.circle.fill" style={{ width: 17, height: 17 }} tintColor={colors.tertiaryLabel} />
          </Pressable>
        </View>
      ) : null}
      {process.env.EXPO_OS === 'ios' ? null : (
        <FilterSheet
          visible={sheet === 'filters'}
          onClose={() => setSheet(null)}
          kind={filters.kind}
          onKind={pickKind}
          peopleSummary={peopleSummary}
          spacesSummary={spaces ? spacesSummary : undefined}
          onPick={(which) => setSheet(which)}
        />
      )}
      <PickSheet
        visible={sheet === 'people'}
        title="Threads with"
        options={[...new Set([...filters.people, ...people])].map((id) => ({ id, name: nameOf(id), avatar: true }))}
        chosen={filters.people}
        onChange={(ids) => onChange({ ...filters, people: ids })}
        onClose={() => setSheet(null)}
      />
      {spaces ? (
        <PickSheet
          visible={sheet === 'spaces'}
          title="Threads in"
          options={spaces}
          chosen={filters.spaces}
          onChange={(ids) => onChange({ ...filters, spaces: ids })}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

/** Android's filter menu: the kinds to pick one of, then the people (and spaces) pickers. */
function FilterSheet({ visible, onClose, kind, onKind, peopleSummary, spacesSummary, onPick }: {
  visible: boolean;
  onClose: () => void;
  kind: ThreadsKind;
  onKind: (kind: ThreadsKind) => void;
  peopleSummary: string | null;
  /** Undefined when the list has no Spaces filter. */
  spacesSummary?: string | null;
  onPick: (which: 'people' | 'spaces') => void;
}) {
  const colors = useColors();
  const picker = (which: 'people' | 'spaces', icon: string, label: string, value: string | null, first: boolean) => (
    <Row first={first} onPress={() => onPick(which)}>
      <Glyph icon={icon} />
      <Text style={{ flex: 1, ...type.body, color: colors.label }}>{label}</Text>
      <Text numberOfLines={1} style={{ ...type.body, color: colors.tertiaryLabel, maxWidth: 150 }}>{value ?? 'Anyone'}</Text>
      <Chevron />
    </Row>
  );
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      style={{ marginHorizontal: 12, marginBottom: 40, padding: 12, gap: 16, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.groupedBackground }}
    >
      <Group label="Show">
        {THREAD_KINDS.map((k, i) => (
          <Row key={k.key} first={i === 0} onPress={() => onKind(k.key)}>
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>{k.label}</Text>
            {kind === k.key ? <Image source="sf:checkmark" style={{ width: 16, height: 16 }} tintColor={colors.accent} /> : null}
          </Row>
        ))}
      </Group>
      <Group>
        {picker('people', 'sf:person.2', 'People', peopleSummary, true)}
        {spacesSummary !== undefined ? picker('spaces', 'sf:number', 'Spaces', spacesSummary ?? 'All', false) : null}
      </Group>
    </BottomSheet>
  );
}

/** A multi-pick list: a thread shows when any chosen one is in it. */
function PickSheet({ visible, title, options, chosen, onChange, onClose }: {
  visible: boolean;
  title: string;
  options: { id: string; name: string; avatar?: boolean }[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      maxHeight={0.7}
      style={{ marginHorizontal: 12, marginBottom: 40, padding: 10, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 6, paddingBottom: 10 }}>
        <Text style={{ flex: 1, ...type.bodyStrong, color: colors.label }}>{title}</Text>
        {chosen.length ? (
          <Pressable onPress={() => onChange([])} hitSlop={10} style={{ marginRight: 16 }}>
            <Text style={{ ...type.body, color: colors.secondaryLabel }}>Clear</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ ...type.bodyStrong, color: colors.label }}>Done</Text>
        </Pressable>
      </View>
      {sorted.length === 0 ? <Text style={{ ...type.caption, color: colors.secondaryLabel, padding: 12 }}>Nobody to pick yet.</Text> : null}
      <ScrollView style={{ flexGrow: 0 }}>
        {sorted.map((o) => {
          const on = chosen.includes(o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                onChange(on ? chosen.filter((id) => id !== o.id) : [...chosen, o.id]);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 12,
                borderRadius: 12, borderCurve: 'continuous', backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
              })}
            >
              {o.avatar ? <Avatar id={o.id} name={o.name} size={26} /> : <Image source="sf:number" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />}
              <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{o.name}</Text>
              <Tick on={on} />
            </Pressable>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

/** Grey when idle, amber when it needs you, green while an agent works; the words sit beside it. */
export function StatusDot({ status }: { status: ThreadStatus }) {
  const colors = useColors();
  const tint = status === 'needs_you' ? '#f59e0b' : status === 'working' ? '#10b981' : colors.tertiaryLabel;
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />;
}

/** The rows, in one card. */
export function ThreadRows({ items, nameOf, onOpen, onLongPress }: {
  items: ThreadItem[];
  nameOf: (memberId: string) => string;
  onOpen: (item: ThreadItem) => void;
  onLongPress?: (item: ThreadItem) => void;
}) {
  const colors = useColors();
  if (items.length === 0) return null;
  return (
    <View style={{ marginHorizontal: 16, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>
      {items.map((item, i) => (
        <ThreadRow key={`${item.spaceId}/${item.rootMessageId}`} item={item} first={i === 0} nameOf={nameOf} onPress={() => onOpen(item)} onLongPress={onLongPress && item.root ? () => onLongPress(item) : undefined} />
      ))}
    </View>
  );
}

function ThreadRow({ item, first, nameOf, onPress, onLongPress }: {
  item: ThreadItem;
  first: boolean;
  nameOf: (memberId: string) => string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const root = item.root;
  const kind = item.topic ? 'Discussion' : root?.session ? (root.archived ? 'Session, ended' : 'Session') : null;
  const replies = root?.replyCount ?? 0;
  const bold = item.unread > 0;
  const meta = [
    item.spaceName,
    kind,
    replies > 0 ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : null,
    timeAgo(item.activityAt),
  ].filter(Boolean).join(' · ');
  const shown = item.people.slice(0, 3);
  return (
    <Pressable
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      onLongPress={
        onLongPress
          ? () => {
              if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onLongPress();
            }
          : undefined
      }
      delayLongPress={300}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.secondaryBackground : 'transparent' })}
    >
      {first ? null : <View style={{ height: 0.5, marginLeft: 14, backgroundColor: colors.separator }} />}
      <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {item.status ? <StatusDot status={item.status} /> : null}
          <Text numberOfLines={2} style={{ flex: 1, ...type.body, fontWeight: bold ? '700' : '500', color: colors.label }}>{item.title}</Text>
          <Badge unread={item.unread} forYou={item.forYou} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row' }}>
            {shown.map((id, i) => (
              <View key={id} style={{ marginLeft: i === 0 ? 0 : -6, borderRadius: 11, borderWidth: 1.5, borderColor: colors.card }}>
                <Avatar id={id} name={nameOf(id)} size={18} />
              </View>
            ))}
          </View>
          <Text numberOfLines={1} style={{ flex: 1, ...type.caption, color: colors.tertiaryLabel }}>
            {item.status ? `${threadStatusLabel(item.status)} · ` : ''}{meta}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Unread replies: a grey count, or a red pill when some are for you (the sidebar's rule). */
function Badge({ unread, forYou }: { unread: number; forYou: number }) {
  const colors = useColors();
  if (unread <= 0) return null;
  const text = (forYou > 0 ? forYou : unread) > 99 ? '99+' : String(forYou > 0 ? forYou : unread);
  if (forYou <= 0) return <Text style={{ ...type.caption, color: colors.tertiaryLabel, fontVariant: ['tabular-nums'] }}>{text}</Text>;
  return (
    <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff3b30' }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff', fontVariant: ['tabular-nums'] }}>{text}</Text>
    </View>
  );
}

/** An empty list's words, under an icon. */
export function ThreadsEmpty({ icon, title, detail, action }: { icon: string; title: string; detail: string; action?: { label: string; onPress: () => void } }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center', marginTop: 48, gap: 6, paddingHorizontal: 32 }}>
      <Image source={icon} style={{ width: 30, height: 30, marginBottom: 6 }} tintColor={colors.tertiaryLabel} />
      <Text style={{ ...type.bodyStrong, color: colors.label, textAlign: 'center' }}>{title}</Text>
      <Text style={{ ...type.caption, lineHeight: 18, textAlign: 'center', color: colors.tertiaryLabel }}>{detail}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8} style={{ marginTop: 6 }}>
          <Text style={{ ...type.caption, fontWeight: '600', color: colors.label }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
