import { Redirect } from 'expo-router';

// The app opens into Spaces. The Mac chat lives at /chat, opt-in via pairing.
export default function Home() {
  return <Redirect href="/spaces" />;
}
