import { Redirect } from 'expo-router';
import * as Linking from 'expo-linking';

// https://<org>/join/<token> opened in the app (universal link / rowboat://
// scheme): hand the full URL to the join screen, which resolves it.
export default function JoinLink() {
  const url = Linking.useLinkingURL();
  return <Redirect href={{ pathname: '/spaces/join', params: url ? { url } : {} }} />;
}
