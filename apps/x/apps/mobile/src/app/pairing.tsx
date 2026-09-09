import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as analytics from '@/lib/analytics';
import { parseQrPayload, probeUrls, useConnection } from '@/lib/connection';
import { useColors } from '@/theme/colors';

// Connect your Mac: says what pairing gives you, walks the three steps, then
// scans the QR from the desktop app (manual entry tucked behind a link — it
// exists for the simulator and edge cases, not the happy path).

export default function PairingScreen() {
  const colors = useColors();
  const { pair } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
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
          "Couldn't reach your Mac. Make sure both devices are on the same Wi-Fi and that network access is on in Rowboat's Phone app settings.",
        );
        setBusy(false);
        handled.current = false;
        return;
      }
      await pair({ url: healthy, token: pairToken, name });
      analytics.mobilePaired(method);
      router.replace('/chat');
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
        setError('Camera access is needed to scan the code — or enter the details manually below.');
        setManual(true);
        return;
      }
    }
    handled.current = false;
    setScanning(true);
  }, [permission, requestPermission]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          {/* What this gives you */}
          <View style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Image source="sf:laptopcomputer.and.iphone" style={{ width: 44, height: 44 }} tintColor={colors.label} />
            <Text style={{ fontSize: 21, fontWeight: '700', color: colors.label }}>Connect your Mac</Text>
            <Text style={{ fontSize: 14, lineHeight: 20, textAlign: 'center', color: colors.secondaryLabel }}>
              Use Rowboat on your Mac from your phone: continue your chats, talk to your agents, and read your
              Brain — live, over your home Wi-Fi.
            </Text>
          </View>

          {/* The three steps */}
          <View style={{ gap: 14, marginTop: 4 }}>
            <StepRow n={1} text="Open the Rowboat app on your Mac." />
            <StepRow n={2} text="Go to Settings → Phone app — a QR code appears." />
            <StepRow n={3} text="Tap Scan below and point your phone at it." />
          </View>

          {scanning ? (
            <View style={{ gap: 10 }}>
              <CameraView
                style={{ height: 300, borderRadius: 14, overflow: 'hidden' }}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onScan}
              />
              <Pressable onPress={() => setScanning(false)} style={{ alignItems: 'center', padding: 8 }}>
                <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              disabled={busy}
              onPress={() => void startScan()}
              style={({ pressed }) => ({
                flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
                paddingVertical: 14, borderRadius: 14, borderCurve: 'continuous',
                backgroundColor: colors.label, opacity: pressed || busy ? 0.7 : 1,
              })}
            >
              <Image source="sf:qrcode.viewfinder" style={{ width: 20, height: 20 }} tintColor={colors.background} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.background }}>Scan pairing code</Text>
            </Pressable>
          )}

          {busy ? <ActivityIndicator /> : null}
          {error ? <Text style={{ fontSize: 14, lineHeight: 20, color: colors.destructive }}>{error}</Text> : null}

          {/* Manual entry, out of the way */}
          {manual ? (
            <View style={{ gap: 10 }}>
              <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>
                The address and token are shown under the QR code on your Mac.
              </Text>
              <TextInput
                style={inputStyle(colors)}
                placeholderTextColor={colors.tertiaryLabel}
                placeholder="Server address (e.g. http://192.168.1.20:3220)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={url}
                onChangeText={setUrl}
              />
              <TextInput
                style={inputStyle(colors)}
                placeholderTextColor={colors.tertiaryLabel}
                placeholder="Pairing token"
                autoCapitalize="none"
                autoCorrect={false}
                value={token}
                onChangeText={setToken}
              />
              <Pressable
                disabled={busy || !url.trim() || !token.trim()}
                onPress={() => void finishPairing([url.trim()], token.trim())}
                style={({ pressed }) => ({
                  paddingVertical: 12, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center',
                  backgroundColor: colors.secondaryBackground,
                  opacity: pressed || busy || !url.trim() || !token.trim() ? 0.6 : 1,
                })}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>Pair</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setManual(true)} style={{ alignItems: 'center', padding: 4 }}>
              <Text style={{ fontSize: 14, color: colors.secondaryLabel }}>Can't scan? Enter the code manually</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepRow({ n, text }: { n: number; text: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
          backgroundColor: colors.secondaryBackground,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.label }}>{n}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colors.label }}>{text}</Text>
    </View>
  );
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    borderWidth: 0.5,
    borderColor: colors.separator,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.label,
    backgroundColor: colors.secondaryBackground,
  } as const;
}
