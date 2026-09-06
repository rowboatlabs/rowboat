import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { ONBOARDED_KEY } from './onboarding';

// First launch walks through onboarding once; after that the app opens
// straight into Spaces. The Mac chat lives at /chat, opt-in via pairing.
export default function Home() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((v) => setOnboarded(v === '1'))
      .catch(() => setOnboarded(true)); // storage hiccup — never trap the user in onboarding
  }, []);

  if (onboarded === null) return null;
  return <Redirect href={onboarded ? '/spaces' : '/onboarding'} />;
}
