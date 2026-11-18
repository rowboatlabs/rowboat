import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/grouped';
import * as analytics from '@/lib/analytics';
import { friendlyError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// New space (2026-11-02, desktop's create form; 2026-11-09: a name is all —
// open spaces went with the orgs). You are its first admin. Creating opens it.
export default function NewSpaceScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const space = await client.createSpace(trimmed);
      analytics.spacesSpaceCreated();
      markSpacesChanged(params.org);
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
      <Text style={{ ...type.caption, color: colors.secondaryLabel, paddingHorizontal: 4 }}>
        Only people you add, or who open its invite link, can see it. You are its first admin.
      </Text>
      <PrimaryButton label={busy ? 'Creating' : 'Create space'} busy={busy} disabled={!name.trim()} onPress={() => void create()} />
    </ScrollView>
  );
}
