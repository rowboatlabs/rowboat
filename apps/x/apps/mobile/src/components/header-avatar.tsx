import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Pressable } from 'react-native';

import { Avatar } from '@/components/avatar';
import { useSpacesAccount } from '@/lib/spaces/account';
import { peekValue } from '@/lib/spaces/cache';
import { useMyAvatar } from '@/lib/spaces/my-avatar';

// You, in the top-right of the Spaces tabs: your photo when you've set one,
// else your initial. Tap → Account.
export function HeaderAvatar() {
  const account = useSpacesAccount();
  const selected = peekValue<string>('selectedOrg');
  const org = account.orgs?.find((o) => o.id === selected) ?? account.orgs?.[0];
  const url = useMyAvatar(org);
  if (!org) return null;
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        router.push('/spaces/account');
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Avatar id={org.memberId} name={org.displayName} size={32} url={url} />
    </Pressable>
  );
}
