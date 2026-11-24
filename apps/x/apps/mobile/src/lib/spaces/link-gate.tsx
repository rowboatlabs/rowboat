import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import type { SpacesOrg } from './account';
import { useSpacesAccount } from './account';

// Where a link that opened the app may go (2026-11-10). A link that launches
// the app arrives while sign-in is still loading and before the server record
// is fetched; redirecting home then threw the link away. 'wait' holds it until
// both are known; 'home' is signed out or unreachable, where Home takes over.
export function useLinkServer(): 'wait' | 'home' | SpacesOrg {
  const { org: address } = useLocalSearchParams<{ org?: string }>();
  const account = useSpacesAccount();
  if (account.status === 'loading') return 'wait';
  if (account.status !== 'signedIn') return 'home';
  const org = account.orgs?.find(o => o.address === address);
  if (org) return org;
  return account.orgs || account.orgsError ? 'home' : 'wait';
}

export function LinkWait() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
