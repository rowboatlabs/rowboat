import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as analytics from '@/lib/analytics';
import { parseQrPayload, probeUrls, useConnection } from '@/lib/connection';

// Pairing: scan the QR in the desktop app's Settings → Phone app tab, or type
// the server address + token by hand (iOS simulator has no camera).

export default function PairingScreen() {
  const { pair } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const finishPairing = useCallback(
    async (candidates: string[], pairToken: string, name?: string, method: 'qr' | 'manual' = 'manual') => {
      setBusy(true);
      setError(null);
      const healthy = await probeUrls(candidates);
      if (!healthy) {
        setError(
          "Couldn't reach your Mac. Check that both devices are on the same network and that network access is turned on in Rowboat's Phone app settings.",
        );
        setBusy(false);
        handled.current = false;
        return;
      }
      await pair({ url: healthy, token: pairToken, name });
      analytics.mobilePaired(method);
      router.replace('/sessions');
    },
    [pair],
  );

  const onScan = useCallback(
    ({ data }: { data: string }) => {
      if (handled.current) return;
      const payload = parseQrPayload(data);
      if (!payload) return; // not our QR; keep scanning
      handled.current = true;
      setScanning(false);
      void finishPairing(payload.urls, payload.token, payload.name, 'qr');
    },
    [finishPairing],
  );

  const startScan = useCallback(async () => {
    setError(null);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera access is needed to scan the pairing code. You can also enter the details manually below.');
        return;
      }
    }
    handled.current = false;
    setScanning(true);
  }, [permission, requestPermission]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.intro}>
          Open Rowboat on your Mac, go to Settings → Phone app, and scan the pairing code.
        </Text>

        {scanning ? (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScan}
            />
            <Button title="Cancel" onPress={() => setScanning(false)} />
          </View>
        ) : (
          <Button title="Scan pairing code" onPress={startScan} disabled={busy} />
        )}

        <View style={styles.divider}>
          <Text style={styles.dividerText}>or enter manually</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholderTextColor="#888"
          placeholder="Server address (e.g. http://192.168.1.20:3220)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={url}
          onChangeText={setUrl}
        />
        <TextInput
          style={styles.input}
          placeholderTextColor="#888"
          placeholder="Pairing token"
          autoCapitalize="none"
          autoCorrect={false}
          value={token}
          onChangeText={setToken}
        />
        <Button
          title="Pair"
          disabled={busy || !url.trim() || !token.trim()}
          onPress={() => void finishPairing([url.trim()], token.trim())}
        />

        {busy && <ActivityIndicator style={styles.spinner} />}
        {error && <Text style={styles.error}>{error}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, padding: 20, gap: 14 },
  intro: { fontSize: 15, lineHeight: 21, opacity: 0.8, color: '#888' },
  cameraWrap: { gap: 8 },
  camera: { height: 280, borderRadius: 12, overflow: 'hidden' },
  divider: { alignItems: 'center', marginVertical: 4 },
  dividerText: { fontSize: 13, opacity: 0.5 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#888',
  },
  spinner: { marginTop: 8 },
  error: { color: '#c0392b', fontSize: 14, lineHeight: 20 },
});
