import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { Space } from '@rowboat/spaces-protocol';

import { Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import * as analytics from '@/lib/analytics';
import { friendlyError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrg, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// New space (2026-11-02, desktop's create form): a name and who can find it.
// Private by default, as on desktop; open spaces show in Browse for everyone
// in the org. Creating opens the space.
export default function NewSpaceScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);
  const org = useOrg(params.org);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Space['visibility']>('private');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const space = await client.createSpace(trimmed, visibility);
      analytics.spacesSpaceCreated();
      markSpacesChanged(params.org);
      if (space.visibility !== visibility) Alert.alert('Created as private', 'This server only makes private spaces until it is updated.');
      router.replace({ pathname: '/spaces/chat', params: { org: params.org, space: space.id, title: space.name, me: params.me } });
    } catch (err) {
      Alert.alert("Couldn't create the space", friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'New space' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
        <Text style={{ ...type.body, color: colors.tertiaryLabel }}>#</Text>
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder="e.g. launch-plans"
          placeholderTextColor={colors.tertiaryLabel}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={128}
          returnKeyType="done"
          onSubmitEditing={() => void create()}
          style={{ flex: 1, paddingVertical: 13, ...type.body, color: colors.label }}
        />
      </View>
      <Group
        label="Who can find it"
        footer={visibility === 'open'
          ? `Anyone in ${org?.name ?? 'the org'} can find and join it from Browse spaces.`
          : 'Only people you add can see it.'}
      >
        <Row first onPress={() => setVisibility('private')}>
          <Glyph icon="sf:lock" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Private</Text>
          <Tick on={visibility === 'private'} />
        </Row>
        <Row onPress={() => setVisibility('open')}>
          <Glyph icon="sf:number" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Open to {org?.name ?? 'the org'}</Text>
          <Tick on={visibility === 'open'} />
        </Row>
      </Group>
      <PrimaryButton label={busy ? 'Creating' : 'Create space'} busy={busy} disabled={!name.trim()} onPress={() => void create()} />
    </ScrollView>
  );
}
