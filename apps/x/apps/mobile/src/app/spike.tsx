import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ipc, turnFollower, turns } from '@x/shared';

// B1 spike screen: proves the shared package — Zod schemas, the turn reducer,
// and the turn-follower protocol — loads and runs under Metro/Hermes. Replaced
// by the real pairing/sessions screens in B3.
function runSpike(): Array<{ label: string; value: string }> {
  const results: Array<{ label: string; value: string }> = [];
  try {
    const state = turns.reduceTurn([]);
    results.push({ label: 'reduceTurn([])', value: `ok — ${JSON.stringify(state).slice(0, 80)}` });
  } catch (err) {
    results.push({ label: 'reduceTurn([])', value: `threw: ${err instanceof Error ? err.message : String(err)}` });
  }
  try {
    const args = ipc.validateRequest('sessions:get', { sessionId: 's1' });
    results.push({ label: 'ipc.validateRequest', value: `ok — ${JSON.stringify(args)}` });
  } catch (err) {
    results.push({ label: 'ipc.validateRequest', value: `threw: ${err instanceof Error ? err.message : String(err)}` });
  }
  results.push({ label: 'ipc.isPushChannel(turns:events)', value: String(ipc.isPushChannel('turns:events')) });
  results.push({ label: 'followTurn', value: typeof turnFollower.followTurn });
  results.push({ label: 'isDurableTurnEvent', value: typeof turns.isDurableTurnEvent });
  return results;
}

export default function SpikeScreen() {
  const results = runSpike();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>@x/shared on Hermes</Text>
        {results.map((r) => (
          <View key={r.label} style={styles.row}>
            <Text style={styles.label}>{r.label}</Text>
            <Text style={styles.value}>{r.value}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  row: { gap: 2 },
  label: { fontSize: 13, fontWeight: '500' },
  value: { fontSize: 13, opacity: 0.7, fontFamily: 'Menlo' },
});
