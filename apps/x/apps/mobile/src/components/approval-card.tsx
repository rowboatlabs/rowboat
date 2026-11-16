import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { APPROVAL_CHOICE_LABELS, ownerSetsUp, type Approval, type ApprovalChoice } from '@rowboat/spaces-protocol';

import { Image } from '@/components/sf-image';
import type { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { useColors } from '@/theme/colors';

// An agent's approval card (spec §8 part 4; desktop approval-card.tsx, brought
// to the phone 2026-11-13): what it asks to do, why, and one button per
// choice it offers. Anyone who can see it may decide; the first decision
// wins, and the card then says who decided. Renders INSTEAD of the message
// body, which is the text fallback for card-blind clients. A super agent's
// request is its owner's alone. A setup card is completed by filling in the
// agent's details in the Agents form, which the phone doesn't have: here it
// says where to do that, and can still be denied.

const DECIDED: Record<ApprovalChoice, string> = {
  allow_once: 'Allowed once',
  allow_session: 'Allowed in this thread',
  allow_always: 'Always allowed',
  deny: 'Denied',
};

export function ApprovalCard({ approval, client, me, memberNames, ownerOf, onDecided }: {
  approval: Approval;
  client: SpacesClient;
  me: string;
  memberNames: ReadonlyMap<string, string>;
  /** An agent's owner, from the space roster (undefined while it loads: the buttons show, and Harbor refuses anyone but the owner). */
  ownerOf: (agentId: string) => string | undefined;
  /** The decision's own answer, folded at once: the live event may trail it. */
  onDecided: (approval: Approval) => void;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState<ApprovalChoice | null>(null);
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState('');
  const agentName = memberNames.get(approval.agentId) ?? 'The agent';
  const nameOf = (id?: string) => (!id ? 'someone' : id === me ? 'you' : memberNames.get(id) ?? 'someone');

  const decide = async (decision: ApprovalChoice, noteText?: string) => {
    if (busy) return;
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setBusy(decision);
    try {
      onDecided(await client.decideApproval(approval.conversation.spaceId, approval.id, { decision, ...(noteText ? { note: noteText } : {}), actingMode: 'direct' }));
      setDenying(false);
    } catch (err) {
      Alert.alert('Couldn’t send that', friendlyError(err, "You're offline. Try again when you're back online."));
    } finally {
      setBusy(null);
    }
  };

  const setup = approval.action ? ownerSetsUp(approval.action) : false;
  const owner = approval.action ? ownerOf(approval.agentId) : undefined;
  const waitingOnOwner = owner !== undefined && owner !== me;
  const allows = setup ? [] : approval.choices.filter((c) => c !== 'deny');
  const canDeny = approval.choices.includes('deny');

  const button = (label: string, onPress: () => void, kind: 'primary' | 'plain' | 'destructive', spinning = false) => (
    <Pressable
      key={label}
      disabled={busy !== null}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7,
        borderRadius: 9, borderCurve: 'continuous',
        backgroundColor: kind === 'primary' ? colors.accent : colors.background,
        borderWidth: kind === 'primary' ? 0 : 0.5, borderColor: colors.separator,
        opacity: pressed || (busy !== null && !spinning) ? 0.6 : 1,
      })}
    >
      {spinning ? <ActivityIndicator size="small" color={kind === 'primary' ? colors.onAccent : colors.secondaryLabel} /> : null}
      <Text style={{ fontSize: 14, fontWeight: '600', color: kind === 'primary' ? colors.onAccent : kind === 'destructive' ? colors.destructive : colors.label }}>{label}</Text>
    </Pressable>
  );

  let footer;
  if (approval.state !== 'open') {
    footer = <Outcome approval={approval} agentName={agentName} nameOf={nameOf} setup={setup} memberNames={memberNames} />;
  } else if (waitingOnOwner) {
    footer = <Text style={{ marginTop: 10, fontSize: 13, color: colors.secondaryLabel }}>Waiting for {memberNames.get(owner) ?? 'its owner'} to {setup ? 'set it up' : 'decide'}.</Text>;
  } else if (denying) {
    footer = (
      <View style={{ marginTop: 10, gap: 8 }}>
        <TextInput
          autoFocus
          value={note}
          onChangeText={setNote}
          maxLength={1000}
          placeholder={`Tell ${agentName} why (optional)`}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="send"
          onSubmitEditing={() => void decide('deny', note.trim() || undefined)}
          style={{
            fontSize: 15, color: colors.label, paddingHorizontal: 10, paddingVertical: 8,
            borderRadius: 9, borderCurve: 'continuous', borderWidth: 0.5, borderColor: colors.separator, backgroundColor: colors.background,
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {button('Deny', () => void decide('deny', note.trim() || undefined), 'destructive', busy === 'deny')}
          {button('Cancel', () => setDenying(false), 'plain')}
        </View>
      </View>
    );
  } else {
    footer = (
      <>
        {setup ? (
          <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 18, color: colors.secondaryLabel }}>
            To set it up, open this thread in Rowboat on your computer or on the web.
          </Text>
        ) : null}
        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {allows.map((choice, i) => button(APPROVAL_CHOICE_LABELS[choice], () => void decide(choice), i === 0 ? 'primary' : 'plain', busy === choice))}
          {canDeny ? button('Deny', () => setDenying(true), 'destructive') : null}
        </View>
      </>
    );
  }

  return (
    <View
      style={{
        marginTop: 4, padding: 12, borderRadius: 12, borderCurve: 'continuous',
        borderWidth: 0.5, borderColor: colors.separator, backgroundColor: colors.secondaryBackground,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Image source="sf:exclamationmark.shield" style={{ width: 17, height: 17 }} tintColor="#f59e0b" />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: colors.label }}>{approval.title}</Text>
      </View>
      {/* An agent's detail is the exact action (a command, a diff); a super agent's request is Harbor's own sentence. */}
      {approval.detail.trim() ? (
        approval.action ? (
          <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 19, color: colors.label }}>{approval.detail}</Text>
        ) : (
          <ScrollView
            nestedScrollEnabled
            style={{ marginTop: 8, maxHeight: 180, borderRadius: 8, borderWidth: 0.5, borderColor: colors.separator, backgroundColor: colors.background }}
            contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
          >
            <Text selectable style={{ fontFamily: 'Menlo', fontSize: 12, lineHeight: 17, color: colors.label }}>{approval.detail}</Text>
          </ScrollView>
        )
      ) : null}
      {approval.reason ? <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: colors.secondaryLabel }}>Why: {approval.reason}</Text> : null}
      {footer}
    </View>
  );
}

function Outcome({ approval, agentName, nameOf, setup, memberNames }: {
  approval: Approval;
  agentName: string;
  nameOf: (id?: string) => string;
  setup: boolean;
  memberNames: ReadonlyMap<string, string>;
}) {
  const colors = useColors();
  const at = new Date(approval.decidedAt ?? approval.updatedAt);
  const when = ` · ${new Date().toDateString() === at.toDateString() ? '' : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} `}${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (approval.state === 'allowed' || approval.state === 'denied') {
    const denied = approval.state === 'denied';
    return (
      <>
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Image source={denied ? 'sf:xmark' : 'sf:checkmark'} style={{ width: 12, height: 12, marginTop: 3 }} tintColor={denied ? colors.destructive : colors.label} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: denied ? colors.destructive : colors.label }}>
            {setup && !denied ? 'Set up' : DECIDED[approval.decision ?? (denied ? 'deny' : 'allow_once')]} by {nameOf(approval.decidedBy)}
            {approval.note ? <Text style={{ color: colors.secondaryLabel }}>: “{approval.note}”</Text> : null}
            <Text style={{ color: colors.tertiaryLabel }}>{when}</Text>
          </Text>
        </View>
        {approval.action && !denied ? <ActionOutcome approval={approval} memberNames={memberNames} /> : null}
      </>
    );
  }
  const expired = approval.state === 'expired';
  return (
    <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Image source={expired ? 'sf:clock' : 'sf:nosign'} style={{ width: 12, height: 12 }} tintColor={colors.secondaryLabel} />
      <Text style={{ flex: 1, fontSize: 13, color: colors.secondaryLabel }}>
        {expired ? `Expired: ${agentName} stopped waiting` : 'Cancelled'}
        <Text style={{ color: colors.tertiaryLabel }}>{when}</Text>
      </Text>
    </View>
  );
}

/** What Harbor did once a super agent's request was allowed: the agent it made or removed, or why it could not. */
function ActionOutcome({ approval, memberNames }: { approval: Approval; memberNames: ReadonlyMap<string, string> }) {
  const colors = useColors();
  const action = approval.action!;
  const name = action.kind === 'create_agent' ? action.displayName : memberNames.get(action.agentId) ?? 'the agent';
  const verb = action.kind === 'create_agent' ? (ownerSetsUp(action) ? 'add' : 'create') : 'delete';
  const style = { marginTop: 6, fontSize: 13, lineHeight: 18, color: colors.secondaryLabel };
  if (!approval.appliedAt) return <Text style={style}>Working on it…</Text>;
  if (approval.outcome?.error) return <Text style={{ ...style, color: colors.destructive }}>Could not {verb} {name}: {approval.outcome.error}</Text>;
  if (action.kind === 'delete_agent') return <Text style={style}>Deleted {name}.</Text>;
  return <Text style={style}>{ownerSetsUp(action) ? `Added ${name} to this space.` : `Created ${name}. It’s getting ready and joins this space.`}</Text>;
}
