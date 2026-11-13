import { currentStatus, notificationsPaused, type Availability } from '@rowboat/spaces-protocol';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { EmojiPicker } from '@/components/emoji-picker';
import { Chevron, Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Status & availability (2026-11-13, mobile parity with the web's
// availability-menu.tsx): away, a custom status, pausing notifications and
// working hours. It is the same `availability` record on the member the web
// edits (PUT /v1/me), so Harbor's notify.ts skips a paused member for push and
// desktop alike — nothing here is stored on the phone.

type Schedule = NonNullable<Availability['schedule']>;
type Sheet = 'status' | 'pause' | 'start' | 'end' | null;

const PAUSES = [30, 60, 120, 240, 1440];
const EXPIRIES: { label: string; minutes: number | null }[] = [
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '24 hours', minutes: 1440 },
  { label: 'Don’t clear', minutes: null },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];
/** Every half hour, "HH:MM" — the phone picks hours from a list, not a typed field. */
const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

function phoneTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function durationLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} minutes` : `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`;
}

function slotLabel(slot: string): string {
  const [h, m] = slot.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function untilLabel(iso: string, now: number): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  return `${at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

/** The protocol's check reads the schedule through Intl; a phone without that time zone just shows "not paused". */
function pausedNow(value: Availability, now: number): boolean {
  try { return notificationsPaused(value, now); } catch { return false; }
}

export default function AvailabilityScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const me = account.orgs?.[0];
  const client = useMemo(
    () => (me ? new SpacesClient({ baseUrl: `https://${me.address}`, token: (opts) => account.getAccessToken(opts) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per server, not per render's token getter
    [me?.address],
  );
  const [value, setValue] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  // Custom shows the day chips without changing the days already chosen (the web's rule, 2026-11-09).
  const [customDays, setCustomDays] = useState(false);
  // Statuses and pauses expire on the clock, not on a server event (the protocol helpers take `now`).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .me()
      .then(({ member }) => { if (!cancelled) setValue(member.availability ?? {}); })
      .catch((err) => { if (!cancelled) setLoadError(friendlyError(err)); });
    return () => { cancelled = true; };
  }, [client]);

  // The server merges the patch's top-level keys into what it holds; the
  // member it returns is the truth we show.
  const save = async (patch: Availability): Promise<boolean> => {
    if (!client) return false;
    setBusy(true);
    setError(null);
    try {
      const member = await client.updateProfile({ availability: patch });
      setValue(member.availability ?? {});
      setNow(Date.now());
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!value) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.groupedBackground }}>
        {loadError ? <Text style={{ ...type.body, color: colors.secondaryLabel, textAlign: 'center' }}>{loadError}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  const status = currentStatus(value, now);
  const paused = pausedNow(value, now);
  const pausedUntil = value.pausedUntil && Date.parse(value.pausedUntil) > now ? value.pausedUntil : null;
  const schedule = value.schedule ?? null;
  const setSchedule = (next: Schedule | null) => void save({ schedule: next, resumedUntil: null });
  const dayPreset = !schedule ? 'weekdays' : customDays ? 'custom' : schedule.days.length === 7 ? 'every'
    : schedule.days.length === 5 && WEEKDAYS.every((d) => schedule.days.includes(d)) ? 'weekdays' : 'custom';
  const zone = phoneTimeZone();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}
    >
      <Group label="Status" footer={value.manualAway ? 'You show as away until you switch this off.' : 'You show as online while Spaces is open on one of your devices.'}>
        <Row first onPress={() => setSheet('status')} disabled={busy}>
          <View style={{ width: 28, alignItems: 'center' }}>
            {status ? <Text style={{ fontSize: 19 }}>{status.emoji || '💬'}</Text> : <Glyph icon="sf:face.smiling" />}
          </View>
          <View style={{ flex: 1, gap: 1, paddingVertical: 10 }}>
            <Text numberOfLines={1} style={{ ...type.body, color: status ? colors.label : colors.secondaryLabel }}>{status?.text || (status ? 'Status set' : 'Update status')}</Text>
            {status?.expiresAt ? <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Clears at {untilLabel(status.expiresAt, now)}</Text> : null}
          </View>
          {status ? (
            <Pressable hitSlop={10} disabled={busy} onPress={() => void save({ status: null })} accessibilityLabel="Clear status">
              <Glyph icon="sf:xmark.circle.fill" tint={colors.tertiaryLabel} />
            </Pressable>
          ) : <Chevron />}
        </Row>
        <Row>
          <Glyph icon="sf:moon" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Appear away</Text>
          <Switch value={!!value.manualAway} disabled={busy} onValueChange={(away) => void save({ manualAway: away })} />
        </Row>
      </Group>

      <Group
        label="Pause notifications"
        footer={paused ? 'No pushes or desktop alerts reach you while paused.' : 'Stops push and desktop notifications from every space for a while.'}
      >
        {paused ? (
          <Row first>
            <Glyph icon="sf:bell.slash" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>
              {pausedUntil ? `Paused until ${untilLabel(pausedUntil, now)}` : status?.pauseNotifications ? 'Paused by your status' : 'Paused outside working hours'}
            </Text>
          </Row>
        ) : null}
        {paused ? (
          // Same as the web: resuming clears a timed pause and overrides the status or schedule for an hour.
          <Row onPress={() => void save({ pausedUntil: null, resumedUntil: new Date(Date.now() + 60 * 60_000).toISOString() })} disabled={busy}>
            <Glyph icon="sf:bell" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Resume for 1 hour</Text>
          </Row>
        ) : null}
        {PAUSES.map((minutes, i) => (
          <Row
            key={minutes}
            first={!paused && i === 0}
            disabled={busy}
            onPress={() => void save({ pausedUntil: new Date(Date.now() + minutes * 60_000).toISOString(), resumedUntil: null })}
          >
            <Glyph icon="sf:clock" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>{durationLabel(minutes)}</Text>
          </Row>
        ))}
        <Row onPress={() => setSheet('pause')} disabled={busy}>
          <Glyph icon="sf:calendar" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Until…</Text>
          <Chevron />
        </Row>
      </Group>

      <Group label="Working hours" footer={schedule ? 'Notifications pause outside these hours. Your online dot still follows when you use the app.' : 'Pause notifications outside the hours you work.'}>
        <Row first>
          <Glyph icon="sf:briefcase" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Working hours</Text>
          <Switch
            value={!!schedule}
            disabled={busy}
            onValueChange={(on) => { setCustomDays(false); setSchedule(on ? { timeZone: zone, days: WEEKDAYS, start: '09:00', end: '17:00' } : null); }}
          />
        </Row>
        {schedule ? (
          <>
            {([['every', 'Every day'], ['weekdays', 'Weekdays'], ['custom', 'Custom']] as const).map(([key, label]) => (
              <Row
                key={key}
                disabled={busy}
                onPress={() => {
                  setCustomDays(key === 'custom');
                  if (key === 'every') setSchedule({ ...schedule, days: [0, 1, 2, 3, 4, 5, 6] });
                  else if (key === 'weekdays') setSchedule({ ...schedule, days: WEEKDAYS });
                }}
              >
                <View style={{ width: 28 }} />
                <Text style={{ flex: 1, ...type.body, color: colors.label }}>{label}</Text>
                {dayPreset === key ? <Glyph icon="sf:checkmark" tint={colors.accent} /> : null}
              </Row>
            ))}
            {dayPreset === 'custom' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingVertical: 12 }}>
                {DAYS.map((day, index) => {
                  const on = schedule.days.includes(index);
                  return (
                    <Pressable
                      key={day}
                      disabled={busy}
                      onPress={() => setSchedule({ ...schedule, days: on ? schedule.days.filter((d) => d !== index) : [...schedule.days, index].sort() })}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderCurve: 'continuous',
                        backgroundColor: on ? colors.accent : colors.secondaryBackground,
                      }}
                    >
                      <Text style={{ ...type.caption, fontWeight: '600', color: on ? colors.onAccent : colors.secondaryLabel }}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <Row onPress={() => setSheet('start')} disabled={busy}>
              <Glyph icon="sf:sunrise" />
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>From</Text>
              <Text style={{ ...type.body, color: colors.secondaryLabel }}>{slotLabel(schedule.start)}</Text>
            </Row>
            <Row onPress={() => setSheet('end')} disabled={busy}>
              <Glyph icon="sf:sunset" />
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>Until</Text>
              <Text style={{ ...type.body, color: colors.secondaryLabel }}>{slotLabel(schedule.end)}</Text>
            </Row>
            {/* The web types an IANA zone; the phone offers its own, and keeps one set elsewhere until you switch. */}
            <Row onPress={schedule.timeZone === zone ? undefined : () => setSchedule({ ...schedule, timeZone: zone })} disabled={busy}>
              <Glyph icon="sf:globe" />
              <View style={{ flex: 1, gap: 1, paddingVertical: 10 }}>
                <Text style={{ ...type.body, color: colors.label }}>Time zone</Text>
                {schedule.timeZone !== zone ? <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Tap to use this phone’s ({zone})</Text> : null}
              </View>
              <Text numberOfLines={1} style={{ ...type.body, color: colors.secondaryLabel, maxWidth: '45%' }}>{schedule.timeZone}</Text>
            </Row>
          </>
        ) : null}
      </Group>

      {busy || error ? (
        <Text style={{ ...type.caption, color: error ? colors.destructive : colors.secondaryLabel, paddingHorizontal: 16 }}>{error ?? 'Saving…'}</Text>
      ) : null}

      <StatusSheet visible={sheet === 'status'} value={value} busy={busy} onClose={() => setSheet(null)} onSave={save} />
      <PauseSheet visible={sheet === 'pause'} busy={busy} onClose={() => setSheet(null)} onSave={save} />
      {schedule ? (
        <SlotSheet
          visible={sheet === 'start' || sheet === 'end'}
          title={sheet === 'end' ? 'Until' : 'From'}
          selected={sheet === 'end' ? schedule.end : schedule.start}
          onClose={() => setSheet(null)}
          onPick={(slot) => {
            setSheet(null);
            setSchedule(sheet === 'end' ? { ...schedule, end: slot } : { ...schedule, start: slot });
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function SheetFrame({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      maxHeight={0.85}
      style={{ paddingTop: 12, paddingBottom: insets.bottom + 12, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.groupedBackground }}
    >
      <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator, marginBottom: 10 }} />
      <Text style={{ ...type.bodyStrong, color: colors.label, textAlign: 'center', marginBottom: 12 }}>{title}</Text>
      {children}
    </BottomSheet>
  );
}

function StatusSheet({ visible, value, busy, onClose, onSave }: {
  visible: boolean; value: Availability; busy: boolean; onClose: () => void; onSave: (patch: Availability) => Promise<boolean>;
}) {
  const colors = useColors();
  const [emoji, setEmoji] = useState('');
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState<number | null>(60);
  const [pause, setPause] = useState(false);
  const [picking, setPicking] = useState(false);
  // Each opening starts from the status as it stands.
  useEffect(() => {
    if (!visible) return;
    const status = currentStatus(value);
    setEmoji(status?.emoji ?? '');
    setText(status?.text ?? '');
    setExpiry(60);
    setPause(status?.pauseNotifications ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [visible]);

  const submit = async () => {
    const trimmed = text.trim();
    const expiresAt = expiry === null ? null : new Date(Date.now() + expiry * 60_000).toISOString();
    const ok = await onSave({
      status: trimmed || emoji ? { text: trimmed, emoji, expiresAt, pauseNotifications: pause } : null,
      ...(pause ? { resumedUntil: null } : {}),
    });
    if (ok) onClose();
  };

  return (
    <SheetFrame visible={visible} onClose={onClose} title="Update status">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 20 }}>
        <Group>
          <Row first>
            <Pressable onPress={() => setPicking(true)} hitSlop={8} style={{ width: 28, alignItems: 'center' }} accessibilityLabel="Choose emoji">
              {emoji ? <Text style={{ fontSize: 19 }}>{emoji}</Text> : <Glyph icon="sf:face.smiling" />}
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="What’s your status?"
              placeholderTextColor={colors.tertiaryLabel}
              maxLength={100}
              returnKeyType="done"
              style={{ flex: 1, ...type.body, color: colors.label, paddingVertical: 12 }}
            />
          </Row>
        </Group>
        <Group label="Clear after">
          {EXPIRIES.map((option, i) => (
            <Row key={option.label} first={i === 0} onPress={() => setExpiry(option.minutes)}>
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>{option.label}</Text>
              {expiry === option.minutes ? <Glyph icon="sf:checkmark" tint={colors.accent} /> : null}
            </Row>
          ))}
        </Group>
        <Group>
          <Row first onPress={() => setPause((p) => !p)}>
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Pause notifications until it clears</Text>
            <Tick on={pause} />
          </Row>
        </Group>
        <PrimaryButton label="Save" busy={busy} onPress={() => void submit()} />
      </ScrollView>
      <EmojiPicker visible={picking} onClose={() => setPicking(false)} onPick={(e) => { setEmoji(e); setPicking(false); }} />
    </SheetFrame>
  );
}

/** A custom pause: a day in the coming week, then a half-hour slot (the web's datetime field). */
function PauseSheet({ visible, busy, onClose, onSave }: {
  visible: boolean; busy: boolean; onClose: () => void; onSave: (patch: Availability) => Promise<boolean>;
}) {
  const colors = useColors();
  const [dayOffset, setDayOffset] = useState(1);
  const [slot, setSlot] = useState('09:00');
  useEffect(() => {
    if (visible) { setDayOffset(1); setSlot('09:00'); }
  }, [visible]);
  const at = new Date();
  at.setDate(at.getDate() + dayOffset);
  const [h, m] = slot.split(':').map(Number);
  at.setHours(h, m, 0, 0);
  const future = at.getTime() > Date.now();

  const submit = async () => {
    if (!future) return;
    if (await onSave({ pausedUntil: at.toISOString(), resumedUntil: null })) onClose();
  };

  return (
    <SheetFrame visible={visible} onClose={onClose} title="Pause notifications until">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }} style={{ flexGrow: 0 }}>
        {Array.from({ length: 7 }, (_, offset) => {
          const day = new Date();
          day.setDate(day.getDate() + offset);
          const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
          const on = offset === dayOffset;
          return (
            <Pressable
              key={offset}
              onPress={() => setDayOffset(offset)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderCurve: 'continuous', backgroundColor: on ? colors.accent : colors.card }}
            >
              <Text style={{ ...type.caption, fontWeight: '600', color: on ? colors.onAccent : colors.secondaryLabel }}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <SlotList selected={slot} onPick={setSlot} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        {!future ? <Text style={{ ...type.caption, color: colors.destructive, textAlign: 'center' }}>Choose a time in the future.</Text> : null}
        <PrimaryButton label={`Pause until ${untilLabel(at.toISOString(), Date.now())}`} busy={busy} disabled={!future} onPress={() => void submit()} />
      </View>
    </SheetFrame>
  );
}

function SlotSheet({ visible, title, selected, onClose, onPick }: {
  visible: boolean; title: string; selected: string; onClose: () => void; onPick: (slot: string) => void;
}) {
  return (
    <SheetFrame visible={visible} onClose={onClose} title={title}>
      <SlotList selected={selected} onPick={onPick} />
    </SheetFrame>
  );
}

function SlotList({ selected, onPick }: { selected: string; onPick: (slot: string) => void }) {
  const colors = useColors();
  // A saved time off the half hour (set on the web) still shows, ticked, in its place.
  const slots = SLOTS.includes(selected) ? SLOTS : [...SLOTS, selected].sort();
  return (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16 }}
      contentOffset={{ x: 0, y: Math.max(0, slots.indexOf(selected) - 3) * 46 }}
    >
      <Group>
        {slots.map((slot, i) => (
          <Row key={slot} first={i === 0} onPress={() => onPick(slot)}>
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>{slotLabel(slot)}</Text>
            {slot === selected ? <Glyph icon="sf:checkmark" tint={colors.accent} /> : null}
          </Row>
        ))}
      </Group>
    </ScrollView>
  );
}
