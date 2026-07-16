import { StyleSheet, Text, View } from 'react-native';

import { useConnection } from '@/lib/connection';

const COLORS = {
  connected: '#2ecc71',
  connecting: '#f39c12',
  disconnected: '#c0392b',
} as const;

const LABELS = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Offline',
} as const;

export function StatusPill() {
  const { status } = useConnection();
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: COLORS[status] }]} />
      <Text style={styles.label}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 12, opacity: 0.7 },
});
