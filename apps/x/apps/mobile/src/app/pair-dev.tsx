import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import * as analytics from '@/lib/analytics';
import { probeUrls, useConnection } from '@/lib/connection';

// Dev-only: pair via deep link, for simulators with no camera to scan the QR.
//   exp://<metro-host>/--/pair-dev?url=http://127.0.0.1:3220&token=<server-key>
// No-op in release builds.

export default function PairDevScreen() {
  const { url, token } = useLocalSearchParams<{ url?: string; token?: string }>();
  const { pair } = useConnection();
  const [message, setMessage] = useState('Pairing…');

  useEffect(() => {
    if (!__DEV__) {
      setMessage('Not available in release builds.');
      return;
    }
    if (!url || !token) {
      setMessage('Missing url or token query params.');
      return;
    }
    void (async () => {
      const healthy = await probeUrls([url]);
      if (!healthy) {
        setMessage(`Could not reach ${url}`);
        return;
      }
      await pair({ url: healthy, token });
      analytics.mobilePaired('dev-link');
      router.replace('/sessions');
    })();
  }, [url, token, pair]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { opacity: 0.7 },
});
